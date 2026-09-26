import { registerRootComponent } from 'expo';

import App from './App';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
function RootApp() { return <SafeAreaProvider><StatusBar style="dark" /><App /></SafeAreaProvider>; }

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(RootApp);
