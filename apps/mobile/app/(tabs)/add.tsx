import { Screen } from '@/components/ui';

/**
 * Fake center tab — the tab bar listener prevents focusing it and opens
 * /expense/new instead, so this screen is never actually rendered.
 */
export default function AddTab() {
  return <Screen padded={false}>{null}</Screen>;
}
