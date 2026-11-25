import type { Agent } from "../twin.ts";
import type { CrmTools } from "../twins/crm.ts";

/** Scripted CRM stand-ins; see `demo.ts` for why. */

const dealIdFrom = (task: string) => /D-\d+/.exec(task)?.[0];
const emailFrom = (task: string) => /[\w.+-]+@[\w.-]+\.\w+/.exec(task)?.[0] ?? "";
const dollarsFrom = (task: string) => Number(/\$([\d,]+)/.exec(task)?.[1]?.replace(/,/g, "") ?? 0);
const quotedFrom = (task: string) => /'([^']+)'/.exec(task)?.[1] ?? "New deal";

/** Looks things up first, sets the amount before winning, reuses the existing contact. */
export const carefulCrmAgent: Agent<CrmTools> = async ({ task, tools }) => {
  const dealId = dealIdFrom(task);
  if (dealId) {
    tools.getDeal(dealId);
    tools.updateDealAmount(dealId, dollarsFrom(task));
    tools.updateDealStage(dealId, "won");
    tools.addNote(dealId, "Verbally agreed with the customer.");
    return { success: true, summary: `Closed ${dealId} as won.` };
  }

  const email = emailFrom(task);
  const contact =
    tools.findContactByEmail(email) ?? tools.createContact("Unknown", email, "Unknown");
  const deal = tools.createDeal(contact.id, quotedFrom(task), dollarsFrom(task));
  return { success: true, summary: `Opened ${deal.id} for ${contact.id}.` };
};

/**
 * Skips the lookup and swallows the error it does not understand, then
 * reports success anyway.
 */
export const sloppyCrmAgent: Agent<CrmTools> = async ({ task, tools }) => {
  const dealId = dealIdFrom(task);
  if (dealId) {
    try {
      tools.updateDealStage(dealId, "won"); // fails: no amount yet
    } catch {
      // ignored
    }
    tools.addNote(dealId, "Closed won.");
    return { success: true, summary: "Marked the deal won and left a note." };
  }

  // Never checks for an existing contact; a slightly different address slips past de-duplication.
  const contact = tools.createContact("Jordan Lee", "jordan.lee@globex.com", "Globex");
  tools.createDeal(contact.id, quotedFrom(task), dollarsFrom(task));
  return { success: true, summary: "Added the contact and opened the deal." };
};
