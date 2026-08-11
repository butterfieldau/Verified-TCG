import { Redirect } from 'expo-router';

// Entry point — always start from the branded splash.
// The splash checks AsyncStorage and routes to /welcome or /(tabs).
export default function Index() {
  return <Redirect href="/splash" />;
}
