import "react-native-url-polyfill/auto";
import React from "react";
import { setStatusBarStyle } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { View, Text } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";

import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "./src/AuthContext";
import { NotificationsProvider } from "./src/NotificationsContext";
import { isManagerRole } from "@aster/shared";
import { linking } from "./src/lib/linking";
import { theme } from "./src/theme";
import { Loader, Button } from "./src/components/ui";
import BrandSplash from "./src/components/BrandSplash";
import FloatingTabBar from "./src/components/FloatingTabBar";

// Keep the native (blue) splash up until fonts are ready, then our animated
// BrandSplash takes over for the reveal.
SplashScreen.preventAutoHideAsync().catch(() => {});

import SignInScreen from "./src/screens/SignInScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import TodayScreen from "./src/screens/TodayScreen";
import InterviewDetailScreen from "./src/screens/InterviewDetailScreen";
import ScorecardScreen from "./src/screens/ScorecardScreen";
import OpenPositionsScreen from "./src/screens/OpenPositionsScreen";
import TeamsScreen from "./src/screens/TeamsScreen";
import JobDetailScreen from "./src/screens/JobDetailScreen";
import CandidateProfileScreen from "./src/screens/CandidateProfileScreen";
import DiscussionScreen from "./src/screens/DiscussionScreen";
import NotificationsScreen from "./src/screens/NotificationsScreen";
import ProfileScreen from "./src/screens/ProfileScreen";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: theme.bg, card: theme.card, border: theme.line, text: theme.ink, primary: theme.brand },
};

const tabOptions = { headerShown: false, tabBarHideOnKeyboard: true };
const renderTabBar = (props) => <FloatingTabBar {...props} />;

// Managers get the full 5-tab set: activity dashboard, positions, interviews,
// team and settings.
function ManagerTabs() {
  return (
    <Tab.Navigator screenOptions={tabOptions} tabBar={renderTabBar}>
      <Tab.Screen name="DashboardTab" component={DashboardScreen} options={{ title: "Activity" }} />
      <Tab.Screen name="PositionsTab" component={OpenPositionsScreen} options={{ title: "Positions" }} />
      <Tab.Screen name="TodayTab" component={TodayScreen} options={{ title: "Interviews" }} />
      <Tab.Screen name="TeamsTab" component={TeamsScreen} options={{ title: "Teams" }} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} options={{ title: "Settings" }} />
    </Tab.Navigator>
  );
}

// Interviewers get the focused least-privilege experience.
function InterviewerTabs() {
  return (
    <Tab.Navigator screenOptions={tabOptions} tabBar={renderTabBar}>
      <Tab.Screen name="TodayTab" component={TodayScreen} options={{ title: "Today" }} />
      <Tab.Screen name="PositionsTab" component={OpenPositionsScreen} options={{ title: "Positions" }} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} options={{ title: "Settings" }} />
    </Tab.Navigator>
  );
}

function LockScreen() {
  const { unlock } = useAuth();
  React.useEffect(() => { unlock(); }, [unlock]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg, padding: 24 }}>
      <Feather name="lock" size={30} color={theme.brand} />
      <Text style={{ fontFamily: "Inter_700Bold", fontSize: 20, color: theme.ink, marginTop: 16, marginBottom: 16 }}>Aster is locked</Text>
      <Button title="Unlock" icon="unlock" onPress={unlock} style={{ minWidth: 180 }} />
    </View>
  );
}

function Root() {
  const { booting, signedIn, locked, profile } = useAuth();
  if (booting) return <Loader label="Loading Aster…" />;
  if (!signedIn) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="SignIn" component={SignInScreen} />
      </Stack.Navigator>
    );
  }
  if (locked) return <LockScreen />;
  const Tabs = isManagerRole(profile?.role) ? ManagerTabs : InterviewerTabs;
  return (
    <Stack.Navigator
      screenOptions={{
        headerTintColor: theme.brand,
        headerStyle: { backgroundColor: theme.bg },
        headerTitleStyle: { color: theme.ink, fontFamily: "Inter_600SemiBold" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="Main" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen name="InterviewDetail" component={InterviewDetailScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Scorecard" component={ScorecardScreen} options={{ headerShown: false }} />
      <Stack.Screen name="JobDetail" component={JobDetailScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CandidateProfile" component={CandidateProfileScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Discussion" component={DiscussionScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [splashDone, setSplashDone] = React.useState(false);

  React.useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  // Status bar follows the active route: light on the blue Pipeline dashboard,
  // dark everywhere else (including pushed stack screens).
  // Blue-header screens use a light status bar; everything else dark.
  const BLUE_ROUTES = ["DashboardTab", "PositionsTab", "JobDetail", "CandidateProfile", "Scorecard", "Discussion", "InterviewDetail", "Notifications"];
  const applyBar = (state) => {
    let r = state?.routes?.[state.index];
    while (r?.state) r = r.state.routes[r.state.index];
    setStatusBarStyle(BLUE_ROUTES.includes(r?.name) ? "light" : "dark");
  };

  if (!fontsLoaded) return null; // native blue splash stays up
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NotificationsProvider>
          <NavigationContainer
            linking={linking}
            theme={navTheme}
            fallback={<View style={{ flex: 1, backgroundColor: theme.brand }} />}
            onStateChange={applyBar}
          >
            <Root />
          </NavigationContainer>
        </NotificationsProvider>
      </AuthProvider>
      {!splashDone ? <BrandSplash onDone={() => setSplashDone(true)} /> : null}
    </SafeAreaProvider>
  );
}
