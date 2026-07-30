// Aster's default offer letter, as a token template, and the filler for it.
// Mirrors OFFER_LETTER_DEFAULT / fillOfferTemplate in the web app: a company can
// save its own wording (companies.offer_letter_template, 0147) and the tokens are
// what let one saved letter still carry the right role, salary and dates for
// every candidate.
export const OFFER_TOKENS = ["{{role}}", "{{company}}", "{{joining_date}}", "{{salary}}", "{{expiry_date}}"];

export const OFFER_LETTER_DEFAULT = [
  `We are pleased to confirm our conditional offer of employment as {{role}} at {{company}}, subject to the following terms and conditions of service:`,
  `EFFECTIVE DATE\nYour appointment will be subject to your reporting for duty on or before **{{joining_date}}**, failing which this offer of employment shall be null and void.`,
  `VALIDITY OF OFFER\nThis offer is open for your acceptance until **{{expiry_date}}**. If your signed acceptance is not received by this date, this offer shall lapse.`,
  `REMUNERATION\nYou will be paid a Basic Salary of **{{salary}} per month** with effect from the date of commencement. All other terms and conditions enforced by the Company from time to time shall apply to you in accordance with your category.`,
  `PROBATION\nYou shall serve a probationary period of three (3) months. The Company reserves the right to extend the probationary period for a further period of three (3) months, if there are justifiable reasons to do so.`,
  `CONFIRMATION\nIf it is found that you are suitable in all or any particular respect for confirmation, the Company may, at its sole discretion, confirm your appointment.`,
  `BONUS\nIncentive bonus may be paid to you at the discretion of the Management depending on your personal performance and contribution towards the profitability of the Company.`,
  `ANNUAL LEAVE\nYou will be entitled to annual leave as per {{company}}'s HR Policies on Terms and Conditions of Service.`,
  `TERMINATION OF EMPLOYMENT\nAfter confirmation of employment, either party maintains the right to terminate this letter of employment by giving to the other not less than two (2) calendar months notice in writing, or payment in lieu of notice.`,
  `COMPANY RULES\nYour appointment shall always be subject to your compliance with any conditions of service or Company rules and practices, either express or implied, for the time being in force.`,
  `NORMAL HOURS OF WORK\nThe normal hours of work shall be a total of 40 hours per week. You shall be required when necessary to work beyond the normal working hours.`,
  `You will be reporting to your immediate superior and be responsible for the duties set out in your Job Description, and for their performance, profitability, market development and budget achievement and control.`,
  `If you are agreeable with the above terms of employment, please signify your acceptance by signing where indicated below.`,
].join("\n\n");

export function fillOfferTemplate(tpl, v) {
  return String(tpl || OFFER_LETTER_DEFAULT)
    .split("{{role}}").join(v.role || "[Position]")
    .split("{{company}}").join(v.company || "[Company]")
    .split("{{joining_date}}").join(v.joiningDate || "[joining date]")
    .split("{{salary}}").join(v.salary || "[Basic Salary]")
    .split("{{expiry_date}}").join(v.expiryDate || "[offer expiry date]");
}

// Toggle **bold** around [a,b). Same rules as the web toolbar so bolding behaves
// identically on both.
export function toggleBoldRange(text, a, b) {
  if (a === b) return null;
  const sel = text.slice(a, b), before = text.slice(0, a), after = text.slice(b);
  if (sel.length > 4 && sel.startsWith("**") && sel.endsWith("**")) {
    const inner = sel.slice(2, -2);
    return { text: before + inner + after, start: a, end: a + inner.length };
  }
  if (before.endsWith("**") && after.startsWith("**")) {
    return { text: before.slice(0, -2) + sel + after.slice(2), start: a - 2, end: b - 2 };
  }
  return { text: before + "**" + sel + "**" + after, start: a + 2, end: b + 2 };
}
