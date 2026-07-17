// Deep-link config. A push tap or an aster:// URL routes straight to the right
// screen. Server-side push payloads should set data.url to one of:
//   aster://interview/<interviewId>
//   aster://scorecard/<candidateId>?job=<jobId>
import * as Linking from "expo-linking";

export const linking = {
  prefixes: [Linking.createURL("/"), "aster://", "https://app.hireaster.com"],
  config: {
    screens: {
      Main: {
        screens: {
          TodayTab: "today",
          PositionsTab: "positions",
          ProfileTab: "me",
        },
      },
      InterviewDetail: "interview/:interviewId",
      Scorecard: "scorecard/:candidateId",
      CandidateProfile: "candidate/:candidateId",
    },
  },
};
