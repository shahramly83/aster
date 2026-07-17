import "react-native-url-polyfill/auto";
import React from "react";
import { StatusBar } from "expo-status-bar";
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

import { AuthProvider, useAuth } from "./src/AuthContext";
import { isManagerRole } from "@aster/shared";
import { linking } from "./src/lib/linking";
import { theme } from "./src/theme";
import { Loader, Button } from "./src/components/ui";

import SignInScreen from "./src/screens/SignInScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import TodayScreen from "./src/screens/TodayScreen";
import InterviewDetailScreen from "./src/screens/InterviewDetailScreen";
import ScorecardScreen from "./src/screens/ScorecardScreen";
import OpenPositionsScreen from "./src/screens/OpenPositionsScreen";
import PositionApplicantsScreen from "./src/screens/PositionApplicantsScreen";
import CandidateProfileScreen from "./src/screens/CandidateProfileScreen";
import ProfileScreen from "./src/screens/ProfileScreen";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: theme.bg, card: theme.card, border: theme.line, text: theme.ink, primary: theme.brand },
};

function tabIcon(name) {
  return ({ color, focused }) => (
    <Feather name={name} size={22} color={color} style={{ opacity: focused ? 1 : 0.9 }} />
  );
}

const screenOptions = {
  headerShown: false,
  tabBarActiveTintColor: theme.brand,
  tabBarInactiveTintColor: theme.ink4,
  tabBarLabelStyle: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  tabBarStyle: { borderTopColor: theme.line, backgroundColor: theme.card, height: 60, paddingTop: 6, paddingBottom: 8 },
  tabBarHideOnKeyboard: true,
};

// Managers get a Pipeline dashboard as home + all-roles Positions.
function ManagerTabs() {
  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen name="DashboardTab" component={DashboardScreen} options={{ title: "Pipeline", tabBarIcon: tabIcon("bar-chart-2") }} />
      <Tab.Screen name="PositionsTab" component={OpenPositionsScreen} options={{ title: "Roles", tabBarIcon: tabIcon("briefcase") }} />
      <Tab.Screen name="TodayTab" component={TodayScreen} options={{ title: "Interviews", tabBarIcon: tabIcon("calendar") }} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} options={{ title: "Me", tabBarIcon: tabIcon("user") }} />
    </Tab.Navigator>
  );
}

// Interviewers get the focused least-privilege experience.
function InterviewerTabs() {
  return (
    <Tab.Navigator screenOptions={screenOptions}>
      <Tab.Screen name="TodayTab" component={TodayScreen} options={{ title: "Today", tabBarIcon: tabIcon("calendar") }} />
      <Tab.Screen name="PositionsTab" component={OpenPositionsScreen} options={{ title: "Positions", tabBarIcon: tabIcon("briefcase") }} />
      <Tab.Screen name="ProfileTab" component={ProfileScreen} options={{ title: "Me", tabBarIcon: tabIcon("user") }} />
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
      <Stack.Screen name="InterviewDetail" component={InterviewDetailScreen} options={{ title: "Interview" }} />
      <Stack.Screen name="Scorecard" component={ScorecardScreen} options={{ title: "Scorecard" }} />
      <Stack.Screen name="PositionApplicants" component={PositionApplicantsScreen} options={{ title: "Candidates" }} />
      <Stack.Screen name="CandidateProfile" component={CandidateProfileScreen} options={{ title: "Candidate" }} />
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
  if (!fontsLoaded) return <Loader />;
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer linking={linking} theme={navTheme} fallback={<Loader />}>
          <StatusBar style="dark" />
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
