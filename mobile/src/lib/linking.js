// Deep-link config. A push tap or an aster:// URL routes straight to the right
// screen. Server-side push payloads set data.url to one of:
//   aster://candidate/<candidateId>?job=<jobId>   (also opens on an interview push)
//   aster://scorecard/<candidateId>?job=<jobId>
import * as Linking from "expo-linking";
import { getStateFromPath as getStateFromPathDefault } from "@react-navigation/native";

// React Navigation maps one path per screen, so a second path for the same
// screen (the scheduling/reminder pushes historically sent aster://interview/…)
// needs a rewrite here rather than an alias in the config. Turn interview/<id>
// into candidate/<id> before the router sees it, so those taps land on the
// candidate profile instead of the default screen.
function getStateFromPath(path, options) {
  const rewritten = path.replace(/^\/?interview\//, "candidate/");
  return getStateFromPathDefault(rewritten, options);
}

export const linking = {
  prefixes: [Linking.createURL("/"), "aster://", "https://app.hireaster.com"],
  getStateFromPath,
  config: {
    screens: {
      Main: {
        screens: {
          DashboardTab: "pipeline",
          TodayTab: "today",
          PositionsTab: "positions",
          TeamsTab: "team",
          ProfileTab: "me",
        },
      },
      Scorecard: "scorecard/:candidateId",
      CandidateProfile: "candidate/:candidateId",
      Discussion: "discussion/:candidateId",
    },
  },
};
