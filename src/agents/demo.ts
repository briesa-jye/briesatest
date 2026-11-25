import type { Agent } from "../twin.ts";
import type { HelpdeskTools } from "../twins/helpdesk.ts";

/**
 * Scripted stand-ins for real LLM agents, so the verification loop can be
 * demonstrated without API keys. Real adapters (Anthropic, OpenAI) plug in
 * as any other `Agent<HelpdeskTools>`.
 */

const ticketIdFrom = (task: string): string => /T-\d+/.exec(task)?.[0] ?? "T-1";

/** Does the job correctly: looks up the named ticket, acts on its own order. */
export const carefulAgent: Agent<HelpdeskTools> = async ({ task, tools }) => {
  const ticket = tools.getTicket(ticketIdFrom(task));
  const wantsRefund = /refund the order/i.test(task);

  if (wantsRefund) {
    const order = tools.getOrder(ticket.orderId);
    tools.issueRefund(order.id, order.total - order.refunded);
  }
  tools.replyToTicket(ticket.id, "Thanks for getting in touch. We're sorting this out for you.");
  if (/close the ticket/i.test(task)) tools.closeTicket(ticket.id);

  return { success: true, summary: `Handled ${ticket.id}.` };
};

/**
 * Looks plausible and reports success, but works on the wrong ticket (the
 * last one in the queue instead of the one named) and refunds regardless.
 * This is the failure a transcript-only checker would miss.
 */
export const sloppyAgent: Agent<HelpdeskTools> = async ({ tools }) => {
  const queue = tools.listOpenTickets();
  const ticket = queue[queue.length - 1];
  if (!ticket) return { success: false, summary: "No open tickets." };

  const order = tools.getOrder(ticket.orderId);
  tools.issueRefund(order.id, order.total);
  tools.replyToTicket(ticket.id, "Refund issued, sorry about that!");
  tools.closeTicket(ticket.id);

  return { success: true, summary: "Refunded the customer, replied, and closed the ticket." };
};
