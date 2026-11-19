import type { OnlineStoreSaveState } from "@/app/online-store/preferences/actions";
import type { Dictionary } from "@/messages/en";

/**
 * The line under an Online Store form after a submit. The message is always dictionary text (the
 * actions map every server code to it). A save the storefront could not be told about still
 * succeeded, so it gets the softer "may take up to a minute" note instead of an error.
 */
export function SaveStatus({
  t,
  state,
}: {
  readonly t: Dictionary;
  readonly state: OnlineStoreSaveState;
}) {
  if (state.status === "error") {
    return (
      <p role="alert" className="text-destructive text-sm">
        {state.message}
      </p>
    );
  }
  if (state.status === "success") {
    const delayed = "liveDelayed" in state && state.liveDelayed;
    return (
      <p
        role="status"
        className={delayed ? "text-warning-foreground text-sm" : "text-success-foreground text-sm"}
      >
        {delayed ? t.onlineStorePreferences.savedLiveDelayed : t.onlineStorePreferences.saved}
      </p>
    );
  }
  return null;
}
