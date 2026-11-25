import { TwinError, createInstrumenter, requireNumber, requireString } from "../twin.ts";
import type { CallRecord, ToolSpec, Twin } from "../twin.ts";

export type Stage = "lead" | "qualified" | "proposal" | "won" | "lost";

export interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
}

export interface Deal {
  id: string;
  contactId: string;
  title: string;
  stage: Stage;
  amount: number;
}

export interface Note {
  id: string;
  dealId: string;
  body: string;
}

/** Everything is keyed by id so state diffs produce stable paths. */
export interface CrmState {
  contacts: Record<string, Contact>;
  deals: Record<string, Deal>;
  notes: Record<string, Note>;
}

export interface CrmTools {
  /** Returns null when there is no match (like a real search endpoint). */
  findContactByEmail(email: string): Contact | null;
  createContact(name: string, email: string, company: string): Contact;
  createDeal(contactId: string, title: string, amount: number): Deal;
  getDeal(id: string): Deal;
  listDeals(contactId: string): Deal[];
  updateDealAmount(id: string, amount: number): Deal;
  updateDealStage(id: string, stage: Stage): Deal;
  addNote(dealId: string, body: string): Note;
  deleteContact(id: string): { id: string };
}

export function defaultCrmSeed(): CrmState {
  return {
    contacts: {
      "C-1": { id: "C-1", name: "Priya Shah", email: "priya@acme.com", company: "Acme" },
      "C-2": { id: "C-2", name: "Jordan Lee", email: "jordan@globex.com", company: "Globex" },
    },
    deals: {
      "D-1": { id: "D-1", contactId: "C-1", title: "Acme renewal", stage: "proposal", amount: 0 },
      "D-2": { id: "D-2", contactId: "C-2", title: "Globex pilot", stage: "lead", amount: 1000 },
    },
    notes: {},
  };
}

const STAGES: Stage[] = ["lead", "qualified", "proposal", "won"];
const isStage = (value: unknown): value is Stage =>
  value === "lost" || STAGES.includes(value as Stage);
const RATE_LIMIT = 100;

/**
 * A stateful CRM twin. Quirks real CRMs have and that agents trip over:
 *  - contacts are de-duplicated on email, case-insensitively (409)
 *  - deals advance one stage at a time; they cannot skip ahead (422)
 *  - a deal needs an amount before it can be won (422)
 *  - won and lost deals are closed for good (409)
 *  - a contact with open deals cannot be deleted (409)
 */
export function createCrmTwin(seed: CrmState = defaultCrmSeed()): Twin<CrmState, CrmTools> {
  const state: CrmState = structuredClone(seed);
  const calls: CallRecord[] = [];
  const counters = {
    C: Object.keys(state.contacts).length,
    D: Object.keys(state.deals).length,
    N: Object.keys(state.notes).length,
  };
  const nextId = (prefix: keyof typeof counters) => `${prefix}-${++counters[prefix]}`;
  const instrument = createInstrumenter(calls, RATE_LIMIT, () => {});

  const contact = (id: string): Contact => {
    const found = state.contacts[id];
    if (!found) throw new TwinError(404, `contact ${id} not found`);
    return found;
  };
  const deal = (id: string): Deal => {
    const found = state.deals[id];
    if (!found) throw new TwinError(404, `deal ${id} not found`);
    return found;
  };
  const openDeal = (id: string): Deal => {
    const found = deal(id);
    if (found.stage === "won" || found.stage === "lost") {
      throw new TwinError(409, `deal ${id} is ${found.stage} and can no longer be changed`);
    }
    return found;
  };

  const tools: CrmTools = {
    findContactByEmail: instrument("findContactByEmail", (email: string) => {
      const wanted = email.trim().toLowerCase();
      return Object.values(state.contacts).find((c) => c.email.toLowerCase() === wanted) ?? null;
    }),
    createContact: instrument("createContact", (name: string, email: string, company: string) => {
      const wanted = email.trim().toLowerCase();
      const existing = Object.values(state.contacts).find((c) => c.email.toLowerCase() === wanted);
      if (existing) {
        throw new TwinError(409, `a contact with email ${email} already exists (${existing.id})`);
      }
      const created: Contact = { id: nextId("C"), name, email: email.trim(), company };
      state.contacts[created.id] = created;
      return created;
    }),
    createDeal: instrument("createDeal", (contactId: string, title: string, amount: number) => {
      contact(contactId);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new TwinError(422, "amount must be zero or more");
      }
      const created: Deal = { id: nextId("D"), contactId, title, stage: "lead", amount };
      state.deals[created.id] = created;
      return created;
    }),
    getDeal: instrument("getDeal", (id: string) => deal(id)),
    listDeals: instrument("listDeals", (contactId: string) =>
      Object.values(state.deals).filter((d) => d.contactId === contactId),
    ),
    updateDealAmount: instrument("updateDealAmount", (id: string, amount: number) => {
      const found = openDeal(id);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new TwinError(422, "amount must be zero or more");
      }
      found.amount = amount;
      return found;
    }),
    updateDealStage: instrument("updateDealStage", (id: string, stage: Stage) => {
      const found = openDeal(id);
      if (!isStage(stage)) throw new TwinError(422, `unknown stage "${String(stage)}"`);
      if (stage !== "lost") {
        const next = STAGES[STAGES.indexOf(found.stage) + 1];
        if (stage !== next) {
          throw new TwinError(
            422,
            `cannot move from ${found.stage} to ${stage}; stages advance one at a time`,
          );
        }
        if (stage === "won" && found.amount <= 0) {
          throw new TwinError(422, "deal needs an amount before it can be won");
        }
      }
      found.stage = stage;
      return found;
    }),
    addNote: instrument("addNote", (dealId: string, body: string) => {
      deal(dealId);
      const created: Note = { id: nextId("N"), dealId, body };
      state.notes[created.id] = created;
      return created;
    }),
    deleteContact: instrument("deleteContact", (id: string) => {
      contact(id);
      const open = Object.values(state.deals).filter(
        (d) => d.contactId === id && d.stage !== "won" && d.stage !== "lost",
      );
      if (open.length > 0) {
        throw new TwinError(409, `contact ${id} has ${open.length} open deal(s); close them first`);
      }
      delete state.contacts[id];
      return { id };
    }),
  };

  const idSchema = (description: string) => ({
    type: "object" as const,
    properties: { id: { type: "string", description } },
    required: ["id"],
  });

  const toolSpecs: ToolSpec[] = [
    {
      name: "find_contact_by_email",
      description: "Look up a contact by email address. Returns null if there is no match.",
      inputSchema: {
        type: "object",
        properties: { email: { type: "string", description: "Email address" } },
        required: ["email"],
      },
      run: (i) => tools.findContactByEmail(requireString(i, "email")),
    },
    {
      name: "create_contact",
      description: "Create a new contact. Fails if a contact with that email already exists.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          company: { type: "string" },
        },
        required: ["name", "email", "company"],
      },
      run: (i) =>
        tools.createContact(requireString(i, "name"), requireString(i, "email"), requireString(i, "company")),
    },
    {
      name: "create_deal",
      description: "Create a deal for a contact. New deals start at the lead stage.",
      inputSchema: {
        type: "object",
        properties: {
          contact_id: { type: "string" },
          title: { type: "string" },
          amount: { type: "number", description: "Deal value in dollars" },
        },
        required: ["contact_id", "title", "amount"],
      },
      run: (i) =>
        tools.createDeal(requireString(i, "contact_id"), requireString(i, "title"), requireNumber(i, "amount")),
    },
    {
      name: "get_deal",
      description: "Fetch a deal by id (e.g. D-1).",
      inputSchema: idSchema("Deal id"),
      run: (i) => tools.getDeal(requireString(i, "id")),
    },
    {
      name: "list_deals",
      description: "List all deals belonging to a contact.",
      inputSchema: {
        type: "object",
        properties: { contact_id: { type: "string" } },
        required: ["contact_id"],
      },
      run: (i) => tools.listDeals(requireString(i, "contact_id")),
    },
    {
      name: "update_deal_amount",
      description: "Set the value of an open deal.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, amount: { type: "number" } },
        required: ["id", "amount"],
      },
      run: (i) => tools.updateDealAmount(requireString(i, "id"), requireNumber(i, "amount")),
    },
    {
      name: "update_deal_stage",
      description:
        "Move a deal to another stage: lead, qualified, proposal, won or lost. Stages advance one step at a time.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          stage: { type: "string", enum: ["lead", "qualified", "proposal", "won", "lost"] },
        },
        required: ["id", "stage"],
      },
      run: (i) => tools.updateDealStage(requireString(i, "id"), requireString(i, "stage") as Stage),
    },
    {
      name: "add_note",
      description: "Attach a note to a deal.",
      inputSchema: {
        type: "object",
        properties: { deal_id: { type: "string" }, body: { type: "string" } },
        required: ["deal_id", "body"],
      },
      run: (i) => tools.addNote(requireString(i, "deal_id"), requireString(i, "body")),
    },
    {
      name: "delete_contact",
      description: "Permanently delete a contact. Fails if the contact has open deals.",
      inputSchema: idSchema("Contact id"),
      run: (i) => tools.deleteContact(requireString(i, "id")),
    },
  ];

  return { tools, toolSpecs, snapshot: () => structuredClone(state), calls };
}
