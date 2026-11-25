import { TwinError, createInstrumenter, requireNumber, requireString } from "../twin.ts";
import type { CallRecord, ToolSpec, Twin } from "../twin.ts";

export interface Customer {
  id: string;
  name: string;
  email: string;
}

export interface Order {
  id: string;
  customerId: string;
  total: number;
  refunded: number;
}

export interface Ticket {
  id: string;
  customerId: string;
  orderId: string;
  subject: string;
  status: "open" | "pending" | "closed";
  updatedAt: number;
}

export interface Refund {
  id: string;
  orderId: string;
  amount: number;
  createdAt: number;
}

export interface Email {
  id: string;
  ticketId: string;
  to: string;
  body: string;
  sentAt: number;
}

/** Everything is keyed by id so state diffs produce stable paths. */
export interface HelpdeskState {
  customers: Record<string, Customer>;
  orders: Record<string, Order>;
  tickets: Record<string, Ticket>;
  refunds: Record<string, Refund>;
  emails: Record<string, Email>;
}

export interface HelpdeskTools {
  getTicket(id: string): Ticket;
  getOrder(id: string): Order;
  listOpenTickets(): Ticket[];
  replyToTicket(ticketId: string, body: string): Email;
  closeTicket(id: string): Ticket;
  issueRefund(orderId: string, amount: number): Refund;
}

export function defaultHelpdeskSeed(): HelpdeskState {
  return {
    customers: {
      "C-1": { id: "C-1", name: "Alex Morgan", email: "alex@example.com" },
      "C-2": { id: "C-2", name: "Sam Rivera", email: "sam@example.com" },
    },
    orders: {
      "O-1": { id: "O-1", customerId: "C-1", total: 40, refunded: 0 },
      "O-2": { id: "O-2", customerId: "C-2", total: 90, refunded: 0 },
    },
    tickets: {
      "T-1": {
        id: "T-1",
        customerId: "C-1",
        orderId: "O-1",
        subject: "Item arrived broken",
        status: "open",
        updatedAt: 0,
      },
      "T-2": {
        id: "T-2",
        customerId: "C-2",
        orderId: "O-2",
        subject: "Where is my order?",
        status: "open",
        updatedAt: 0,
      },
    },
    refunds: {},
    emails: {},
  };
}

const RATE_LIMIT = 100;

/**
 * A stateful helpdesk + payments twin. It copies the behaviours real
 * integrations have and that agents routinely get wrong:
 *  - replying to an open ticket moves it to "pending" (not "closed")
 *  - closed tickets reject replies (409)
 *  - refunds cannot exceed the refundable balance (422)
 *  - a call budget is enforced (429)
 */
export function createHelpdeskTwin(
  seed: HelpdeskState = defaultHelpdeskSeed(),
): Twin<HelpdeskState, HelpdeskTools> {
  const state: HelpdeskState = structuredClone(seed);
  const calls: CallRecord[] = [];
  let tick = 1000;

  const nextId = (prefix: string, records: Record<string, unknown>) =>
    `${prefix}-${Object.keys(records).length + 1}`;

  const ticket = (id: string): Ticket => {
    const found = state.tickets[id];
    if (!found) throw new TwinError(404, `ticket ${id} not found`);
    return found;
  };

  const order = (id: string): Order => {
    const found = state.orders[id];
    if (!found) throw new TwinError(404, `order ${id} not found`);
    return found;
  };

  const instrument = createInstrumenter(calls, RATE_LIMIT, () => {
    tick += 1;
  });

  const tools: HelpdeskTools = {
    getTicket: instrument("getTicket", (id: string) => ticket(id)),
    getOrder: instrument("getOrder", (id: string) => order(id)),
    listOpenTickets: instrument("listOpenTickets", () =>
      Object.values(state.tickets).filter((t) => t.status !== "closed"),
    ),
    replyToTicket: instrument("replyToTicket", (ticketId: string, body: string) => {
      const t = ticket(ticketId);
      if (t.status === "closed") {
        throw new TwinError(409, `ticket ${ticketId} is closed; reopen it before replying`);
      }
      const customer = state.customers[t.customerId];
      if (!customer) throw new TwinError(500, `ticket ${ticketId} has no customer`);
      const email: Email = {
        id: nextId("E", state.emails),
        ticketId,
        to: customer.email,
        body,
        sentAt: tick,
      };
      state.emails[email.id] = email;
      if (t.status === "open") t.status = "pending";
      t.updatedAt = tick;
      return email;
    }),
    closeTicket: instrument("closeTicket", (id: string) => {
      const t = ticket(id);
      t.status = "closed";
      t.updatedAt = tick;
      return t;
    }),
    issueRefund: instrument("issueRefund", (orderId: string, amount: number) => {
      const o = order(orderId);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new TwinError(422, "refund amount must be greater than zero");
      }
      const refundable = o.total - o.refunded;
      if (amount > refundable) {
        throw new TwinError(422, `amount exceeds refundable balance (${refundable})`);
      }
      const refund: Refund = {
        id: nextId("R", state.refunds),
        orderId,
        amount,
        createdAt: tick,
      };
      state.refunds[refund.id] = refund;
      o.refunded += amount;
      return refund;
    }),
  };

  const idSchema = (description: string) => ({
    type: "object" as const,
    properties: { id: { type: "string", description } },
    required: ["id"],
  });

  const toolSpecs: ToolSpec[] = [
    {
      name: "get_ticket",
      description: "Fetch a support ticket by id (e.g. T-1).",
      inputSchema: idSchema("Ticket id"),
      run: (i) => tools.getTicket(requireString(i, "id")),
    },
    {
      name: "get_order",
      description: "Fetch an order by id (e.g. O-1), including its total and amount already refunded.",
      inputSchema: idSchema("Order id"),
      run: (i) => tools.getOrder(requireString(i, "id")),
    },
    {
      name: "list_open_tickets",
      description: "List every ticket that is not closed.",
      inputSchema: { type: "object", properties: {}, required: [] },
      run: () => tools.listOpenTickets(),
    },
    {
      name: "reply_to_ticket",
      description: "Email the customer on a ticket. Fails if the ticket is closed.",
      inputSchema: {
        type: "object",
        properties: {
          ticket_id: { type: "string", description: "Ticket id" },
          body: { type: "string", description: "Message to send to the customer" },
        },
        required: ["ticket_id", "body"],
      },
      run: (i) => tools.replyToTicket(requireString(i, "ticket_id"), requireString(i, "body")),
    },
    {
      name: "close_ticket",
      description: "Mark a ticket as closed.",
      inputSchema: idSchema("Ticket id"),
      run: (i) => tools.closeTicket(requireString(i, "id")),
    },
    {
      name: "issue_refund",
      description: "Refund part or all of an order. The amount cannot exceed what is still refundable.",
      inputSchema: {
        type: "object",
        properties: {
          order_id: { type: "string", description: "Order id" },
          amount: { type: "number", description: "Amount to refund, in dollars" },
        },
        required: ["order_id", "amount"],
      },
      run: (i) => tools.issueRefund(requireString(i, "order_id"), requireNumber(i, "amount")),
    },
  ];

  return { tools, toolSpecs, snapshot: () => structuredClone(state), calls };
}
