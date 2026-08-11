// App root: providers, bottom-tab + stack navigation, the persistent mini
// player, and deep-linking from an hourly-verse notification into the reader.
import { Ionicons } from '@expo/vector-icons';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { BottomTabBar, createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useEffect } from 'react';
import { useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import ErrorBoundary from './src/components/ErrorBoundary';
import MiniPlayer from './src/components/MiniPlayer';
import { PlayerProvider } from './src/context/PlayerContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { onNotificationTap } from './src/lib/notifications';
import BookmarksScreen from './src/screens/BookmarksScreen';
import HomeScreen from './src/screens/HomeScreen';
import PrayerTimesScreen from './src/screens/PrayerTimesScreen';
import ReaderScreen from './src/screens/ReaderScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import SurahListScreen from './src/screens/SurahListScreen';
import { palette } from './src/theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
export const navigationRef = createNavigationContainerRef();

function QuranStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="SurahList"
        component={SurahListScreen}
        options={{ title: 'Al-Quran' }}
      />
      <Stack.Screen name="Reader" component={ReaderScreen} options={{ title: '' }} />
    </Stack.Navigator>
  );
}

// Render the mini player just above the native tab bar.
function TabBar(props) {
  return (
    <View>
      <MiniPlayer />
      <BottomTabBar {...props} />
    </View>
  );
}

const ICONS = {
  HomeTab: 'home',
  QuranTab: 'book',
  BookmarksTab: 'bookmark',
  PrayerTab: 'time',
  SettingsTab: 'settings',
};

export default function App() {
  const scheme = useColorScheme();

  useEffect(() => {
    // Tapping an hourly-verse notification opens that surah at the ayah.
    const unsub = onNotificationTap((data) => {
      if (!navigationRef.isReady()) return;
      navigationRef.navigate('QuranTab', {
        screen: 'Reader',
        params: { surah: data.surah, scrollToAyah: data.ayah },
        initial: false,
      });
    });
    return unsub;
  }, []);

  return (
    <ErrorBoundary>
    <SafeAreaProvider>
      <SettingsProvider>
        <PlayerProvider>
          <NavigationContainer
            ref={navigationRef}
            theme={scheme === 'dark' ? DarkTheme : DefaultTheme}
          >
            <Tab.Navigator
              tabBar={(props) => <TabBar {...props} />}
              screenOptions={({ route }) => ({
                headerShown: false,
                tabBarActiveTintColor: palette.emerald,
                tabBarIcon: ({ color, size }) => (
                  <Ionicons name={ICONS[route.name]} size={size} color={color} />
                ),
              })}
            >
              <Tab.Screen name="HomeTab" component={HomeScreen} options={{ title: 'Utama' }} />
              <Tab.Screen name="QuranTab" component={QuranStack} options={{ title: 'Al-Quran' }} />
              <Tab.Screen
                name="BookmarksTab"
                component={BookmarksScreen}
                options={{ title: 'Penanda' }}
              />
              <Tab.Screen
                name="PrayerTab"
                component={PrayerTimesScreen}
                options={{ title: 'Solat' }}
              />
              <Tab.Screen
                name="SettingsTab"
                component={SettingsScreen}
                options={{ title: 'Tetapan' }}
              />
            </Tab.Navigator>
          </NavigationContainer>
        </PlayerProvider>
      </SettingsProvider>
    </SafeAreaProvider>
    </ErrorBoundary>
  );
}
