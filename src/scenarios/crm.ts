import type { Scenario } from "../scenario.ts";
import { createCrmTwin } from "../twins/crm.ts";
import type { CrmState, CrmTools } from "../twins/crm.ts";

export type CrmScenario = Scenario<CrmState, CrmTools>;

export const winDeal: CrmScenario = {
  id: "win-deal",
  title: "Close a verbally agreed deal as won, with a note",
  task: "Deal D-1 (Acme renewal) was verbally agreed at $12,000. Set the deal amount, mark it won, and add a note recording the agreement.",
  twin: () => createCrmTwin(),
  spec: {
    required: [
      { description: "Deal D-1 amount is 12000", path: "deals.D-1.amount", equals: 12000 },
      { description: "Deal D-1 is won", path: "deals.D-1.stage", equals: "won" },
      { description: "A note is attached to D-1", path: "notes.*.dealId", equals: "D-1" },
    ],
    allowed: ["notes.*.**"],
  },
};

export const quoteExistingContact: CrmScenario = {
  id: "quote-existing-contact",
  title: "Open a deal for an existing contact without duplicating them",
  task: "Jordan Lee (jordan@globex.com, Globex) asked for a quote. Make sure they are in the CRM, then open a deal called 'Globex quote' worth $5,000 for them.",
  twin: () => createCrmTwin(),
  spec: {
    required: [
      { description: "A new deal is linked to Jordan (C-2)", path: "deals.D-3.contactId", equals: "C-2" },
      { description: "The deal is titled 'Globex quote'", path: "deals.D-3.title", equals: "Globex quote" },
      { description: "The deal is worth 5000", path: "deals.D-3.amount", equals: 5000 },
    ],
    // The new deal's remaining fields (id, stage). Any new contact is collateral.
    allowed: ["deals.D-3.**"],
  },
};

export const crmScenarios: CrmScenario[] = [winDeal, quoteExistingContact];
