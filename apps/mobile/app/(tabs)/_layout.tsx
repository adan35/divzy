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

/** Big brand circle for the fake center Add tab. */
function AddTabIcon() {
  const { colors } = useTheme();
  return (
    <View style={[styles.addButton, { backgroundColor: colors.brand }]}>
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
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -6,
  },
});
