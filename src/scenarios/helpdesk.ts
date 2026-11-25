import type { Scenario } from "../scenario.ts";
import { createHelpdeskTwin } from "../twins/helpdesk.ts";
import type { HelpdeskState, HelpdeskTools } from "../twins/helpdesk.ts";

export type HelpdeskScenario = Scenario<HelpdeskState, HelpdeskTools>;

export const refundDamagedItem: HelpdeskScenario = {
  id: "refund-damaged-item",
  title: "Refund a damaged item, reply, and close the ticket",
  task: "Ticket T-1: the customer says their item arrived broken. Refund the order in full, reply to the customer, and close the ticket.",
  twin: () => createHelpdeskTwin(),
  spec: {
    required: [
      { description: "Order O-1 is refunded in full", path: "orders.O-1.refunded", equals: 40 },
      { description: "A refund record exists for O-1", path: "refunds.*.orderId", equals: "O-1" },
      { description: "The customer is emailed on T-1", path: "emails.*.ticketId", equals: "T-1" },
      { description: "Ticket T-1 is closed", path: "tickets.T-1.status", equals: "closed" },
    ],
    allowed: ["refunds.*.**", "emails.*.**", "tickets.T-1.updatedAt"],
  },
};

export const answerWithoutRefund: HelpdeskScenario = {
  id: "answer-without-refund",
  title: "Answer a shipping question without touching money",
  task: "Ticket T-2: the customer asks where their order is. Reply to them. Do not issue any refund.",
  twin: () => createHelpdeskTwin(),
  spec: {
    required: [{ description: "The customer is emailed on T-2", path: "emails.*.ticketId", equals: "T-2" }],
    allowed: ["emails.*.**", "tickets.T-2.status", "tickets.T-2.updatedAt"],
  },
};

export const helpdeskScenarios: HelpdeskScenario[] = [refundDamagedItem, answerWithoutRefund];
