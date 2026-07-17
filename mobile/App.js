import "react-native-url-polyfill/auto";
import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { View, Text } from "react-native";

import { AuthProvider, useAuth } from "./src/AuthContext";
import { linking } from "./src/lib/linking";
import { theme } from "./src/theme";
import { Loader, Button } from "./src/components/ui";

import SignInScreen from "./src/screens/SignInScreen";
import TodayScreen from "./src/screens/TodayScreen";
import InterviewDetailScreen from "./src/screens/InterviewDetailScreen";
import ScorecardScreen from "./src/screens/ScorecardScreen";
import OpenPositionsScreen from "./src/screens/OpenPositionsScreen";
import PositionApplicantsScreen from "./src/screens/PositionApplicantsScreen";
import CandidateProfileScreen from "./src/screens/CandidateProfileScreen";
import ProfileScreen from "./src/screens/ProfileScreen";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// Simple text glyphs for the tab bar (no icon font dependency).
function TabIcon({ label, focused }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>{label}</Text>;
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.ink3,
        tabBarStyle: { borderTopColor: theme.line },
      }}
    >
      <Tab.Screen
        name="TodayTab"
        component={TodayScreen}
        options={{ title: "Today", tabBarIcon: ({ focused }) => <TabIcon label="📅" focused={focused} /> }}
      />
      <Tab.Screen
        name="PositionsTab"
        component={OpenPositionsScreen}
        options={{ title: "Positions", tabBarIcon: ({ focused }) => <TabIcon label="💼" focused={focused} /> }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{ title: "Me", tabBarIcon: ({ focused }) => <TabIcon label="👤" focused={focused} /> }}
      />
    </Tab.Navigator>
  );
}

function LockScreen() {
  const { unlock } = useAuth();
  React.useEffect(() => {
    unlock();
  }, [unlock]);
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg, padding: 24 }}>
      <Text style={{ fontSize: 22, fontWeight: "800", color: theme.ink, marginBottom: 16 }}>Aster is locked</Text>
      <Button title="Unlock" onPress={unlock} style={{ minWidth: 160 }} />
    </View>
  );
}

function Root() {
  const { booting, signedIn, locked } = useAuth();
  if (booting) return <Loader label="Loading Aster…" />;
  if (!signedIn) {
    return (
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="SignIn" component={SignInScreen} />
      </Stack.Navigator>
    );
  }
  if (locked) return <LockScreen />;
  return (
    <Stack.Navigator
      screenOptions={{
        headerTintColor: theme.brand,
        headerStyle: { backgroundColor: theme.bg },
        headerTitleStyle: { color: theme.ink },
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="Main" component={MainTabs} options={{ headerShown: false }} />
      <Stack.Screen name="InterviewDetail" component={InterviewDetailScreen} options={{ title: "Interview" }} />
      <Stack.Screen name="Scorecard" component={ScorecardScreen} options={{ title: "Scorecard" }} />
      <Stack.Screen name="PositionApplicants" component={PositionApplicantsScreen} options={{ title: "Candidates" }} />
      <Stack.Screen name="CandidateProfile" component={CandidateProfileScreen} options={{ title: "Candidate" }} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer linking={linking} fallback={<Loader />}>
          <StatusBar style="dark" />
          <Root />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
