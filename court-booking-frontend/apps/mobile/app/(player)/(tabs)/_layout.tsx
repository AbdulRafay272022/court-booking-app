import { Tabs } from "expo-router";
import { CalendarIcon, HomeIcon, PersonIcon } from "@/components/icons";

const INACTIVE = "#A8A099";
const ACTIVE = "#141A1D";

export default function PlayerTabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700" },
        tabBarStyle: { borderTopColor: "#EBE5E1" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Home", tabBarIcon: ({ color }) => <HomeIcon size={21} color={String(color)} /> }}
      />
      <Tabs.Screen
        name="bookings"
        options={{ title: "Bookings", tabBarIcon: ({ color }) => <CalendarIcon size={21} color={String(color)} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "You", tabBarIcon: ({ color }) => <PersonIcon size={21} color={String(color)} /> }}
      />
    </Tabs>
  );
}
