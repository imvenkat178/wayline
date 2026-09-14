import {DomainError} from './journeys.mjs';
// These channels accept instructions, not identity, contact, account or payment values.
// Protected forms use separate authenticated endpoints and are never passed here.
export function protectConversationInput(input) {
 if(typeof input!=='string')return;
 const secret=/\b(?:password|passcode|authentication code|verification code|otp|cvv|passport(?: number)?|ssn|social security number)\s*(?:is\s+|[:=]\s*)?(?:["'][^"']+["']|[A-Za-z0-9][^\s!?]{2,})/i;
 const identity=/\b(?:my name is|passenger name(?: is)?|date of birth(?: is)?|dob(?: is)?|born on)\s*[:=]?\s*\S+/i;
 const contact=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+\d[\d ()-]{8,}\d|\b\d{3}[ .-]\d{3}[ .-]\d{4}\b/i;
 if(secret.test(input)||identity.test(input)||contact.test(input)||/\b(?:\d[ -]?){13,19}\b/.test(input))throw new DomainError('Use the protected form for passenger, contact, account and payment details. These values cannot be sent to the language model.',400,'PROTECTED_INPUT_REQUIRED');
}
