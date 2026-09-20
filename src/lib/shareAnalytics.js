import { base44 } from "@/api/base44Client";

// Privacy-safe share analytics. No wallet addresses or private data are sent —
// only the event name and non-identifying properties.
export function trackShare(eventName, properties = {}) {
  try {
    base44.analytics.track({ eventName, properties });
  } catch {
    // analytics must never break the sharing flow
  }
}

export const SHARE_EVENTS = {
  SHOUT_MODAL_OPENED: "shout_modal_opened",
  X_COMPOSER_OPENED: "x_composer_opened",
  NATIVE_SHARE_INVOKED: "native_share_invoked",
  POST_TEXT_COPIED: "post_text_copied",
  CASE_LINK_COPIED: "case_link_copied",
  VERDICT_CARD_DOWNLOADED: "verdict_card_downloaded",
  SHOUTIT_SUBMISSION_CREATED: "shoutit_submission_created",
  CHALLENGE_CREATED: "challenge_created",
  CHALLENGE_ACCEPTED: "challenge_accepted",
  CHALLENGE_COMPLETED: "challenge_completed",
  SUMMONS_CREATED: "summons_created",
  SUMMONS_SHARED: "summons_shared",
  SUMMONS_SERVED: "summons_served",
  COURT_RECEIPT_DOWNLOADED: "court_receipt_downloaded",
  COURT_RECEIPT_SHARED: "court_receipt_shared",
  HALL_CATEGORY_SEE_ALL: "hall_category_see_all",
  HALL_CATEGORY_LOAD_MORE: "hall_category_load_more",
  HALL_HONOR_CASE_OPENED: "hall_honor_case_opened",
  DAILY_AWARD_OPENED: "daily_award_opened",
  DAILY_AWARD_SHARED: "daily_award_shared",
  EVIDENCE_SNAPSHOT_EXPANDED: "evidence_snapshot_expanded",
  EVIDENCE_SNAPSHOT_COLLAPSED: "evidence_snapshot_collapsed",
};