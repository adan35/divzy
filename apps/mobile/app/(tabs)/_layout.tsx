import { StyleSheet, View } from 'react-native';
import { Redirect, Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

function tabIcon(focusedName: IconName, idleName: IconName) {
  return function TabIcon({
    color,
    size,
    focused,
  }: {
    color: string;
    size: number;
    focused: boolean;
  }) {
    return <Ionicons name={focused ? focusedName : idleName} size={size} color={color} />;
  };
}

/**
 * Big brand-fill circle for the fake center Add tab (spec-WI-068 §9.2: 48pt,
 * `brandFill`, light-mode-only shadow — dark elevation uses no shadows,
 * spec §1.1).
 */
function AddTabIcon() {
  const { colors, scheme } = useTheme();
  return (
    <View
      style={[
        styles.addButton,
        { backgroundColor: colors.brandFill },
        scheme === 'light' && [styles.addButtonShadow, { shadowColor: colors.ink }],
      ]}
    >
      <Ionicons name="add" size={26} color={colors.onBrand} />
    </View>
  );
}

export default function TabsLayout() {
  const { status } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();

  if (status === 'loading') return null;
  if (status === 'guest') return <Redirect href="/(auth)/login" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.ink3,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.hairline,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        sceneStyle: { backgroundColor: colors.page },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: tabIcon('home', 'home-outline') }}
      />
      <Tabs.Screen
        name="groups"
        options={{ title: 'Groups', tabBarIcon: tabIcon('people', 'people-outline') }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: '',
          tabBarIcon: AddTabIcon,
          tabBarAccessibilityLabel: 'Add expense',
        }}
        listeners={{
          tabPress: (event) => {
            // Fake tab: never focus it — open the expense editor instead.
            event.preventDefault();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
            router.push('/expense/new');
          },
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{ title: 'Friends', tabBarIcon: tabIcon('person', 'person-outline') }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: tabIcon('person-circle', 'person-circle-outline'),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: 'More',
          tabBarIcon: tabIcon('ellipsis-horizontal', 'ellipsis-horizontal-outline'),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -6,
  },
  addButtonShadow: {
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
});
