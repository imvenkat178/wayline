import { DomainError } from "../domain/journeys.mjs";
import { checkFlightCandidate } from "../domain/workspaceFlights.mjs";

export function workspaceReviewBinding(store, userId, search, offerId) {
  if (!search.conversationId) return {};
  const conversation = store.get(userId, search.conversationId, "conversation");
  const draft = store.get(userId, conversation.draftId, "trip-draft");
  const set = draft.selected?.setId ? store.get(userId, draft.selected.setId, "candidate-set") : null;
  if (draft.conversationId !== conversation.id || set?.conversationId !== conversation.id || set?.searchId !== search.id || draft.selected?.flight?.id !== offerId)
    throw new DomainError("Select this offer in its conversation before requesting a review.", 409, "DRAFT_CHANGED");
  return { conversationId: conversation.id, draftId: draft.id, draftVersion: draft.version, setId: set.id, optionId: draft.selected.optionId };
}
export function assertWorkspaceReview(store, userId, review, candidate = review.candidate) {
  const search = store.get(userId, review.searchId, "shopping-search");
  if (!search.conversationId && !review.conversationId) return;
  if (search.conversationId !== review.conversationId) throw new DomainError("Review is missing its conversation binding.", 409, "DRAFT_CHANGED");
  const current = workspaceReviewBinding(store, userId, search, review.offer.id);
  if (Object.keys(current).some(k => current[k] !== review[k])) throw new DomainError("Your trip draft changed. Select an offer and request a new review.", 409, "DRAFT_CHANGED");
  if (candidate) {
    const draft = store.get(userId, current.draftId, "trip-draft");
    const check = checkFlightCandidate(candidate, draft.constraints, draft.locks);
    if (check.reasons.length) throw new DomainError(check.reasons.join("; "), 409, "CONSTRAINT_CONFLICT");
  }
}
