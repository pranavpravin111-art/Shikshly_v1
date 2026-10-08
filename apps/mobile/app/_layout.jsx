import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
export default function Layout() { return <><StatusBar barStyle="dark-content" backgroundColor="#f6f8f4"/><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#f6f8f4' } }}/></>; }
