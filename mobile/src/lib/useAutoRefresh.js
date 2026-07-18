import { useCallback } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { subscribeDashboard } from "./data";

// Keeps a screen's data live while it's focused:
//   1. loads once on focus,
//   2. subscribes to company-wide application/job/activity changes (realtime),
//   3. polls every `poll` ms as a fallback where realtime isn't enabled,
//   4. refreshes when the app returns to the foreground.
// `load` must be a stable useCallback. Everything is torn down on blur so we
// never poll or hold a channel for a screen the user isn't looking at.
export function useAutoRefresh(companyId, load, { poll = 30000 } = {}) {
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const run = () => { if (active) load(); };
      run(); // initial fetch on focus

      const unsub = companyId ? subscribeDashboard(companyId, run) : () => {};
      const timer = poll ? setInterval(run, poll) : null;
      const appSub = AppState.addEventListener("change", (s) => { if (s === "active") run(); });

      return () => {
        active = false;
        unsub();
        if (timer) clearInterval(timer);
        appSub.remove();
      };
    }, [companyId, load, poll])
  );
}
