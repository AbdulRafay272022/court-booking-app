import { Tabs } from "expo-router";
import { CalendarDays, House, MessageCircle, UserRound } from "lucide-react-native";
import { TabBar, useCopy, type IconComponent } from "@/components/ui";

const TABS: { name: "index" | "bookings" | "chat" | "profile"; ru: string; en: string; icon: IconComponent }[] = [
  { name: "index", ru: "Home", en: "Home", icon: House },
  { name: "bookings", ru: "Bookings", en: "Bookings", icon: CalendarDays },
  { name: "chat", ru: "Chat", en: "Chat", icon: MessageCircle },
  { name: "profile", ru: "Profile", en: "Profile", icon: UserRound },
];

/** Main board: 4 tabs on the floating glass TabBar, orange active pill (player role). One bottom inset: the bar floats
 * above the home indicator and every tab screen reserves room for it (Screen floatingBar="tabs"), audit G8. */
export default function PlayerTabsLayout() {
  const copy = useCopy();
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigation }) => (
        <TabBar
          items={state.routes.map((route, i) => {
            const tab = TABS.find((t) => t.name === route.name) ?? TABS[0];
            const label = copy(tab.ru, tab.en);
            return {
              key: route.key,
              label,
              icon: tab.icon,
              active: state.index === i,
              accessibilityLabel: label,
              testID: `tab-${tab.name}`,
              onPress: () => {
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (state.index !== i && !event.defaultPrevented) navigation.navigate(route.name);
              },
            };
          })}
        />
      )}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.en }} />
      ))}
    </Tabs>
  );
}
