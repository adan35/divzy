// spec-WI-033 — TabsList must not become an unintended vertical scroll
// container. `overflow-x-auto` alone leaves `overflow-y` to compute as `auto`
// per the CSS overflow spec, reserving a scrollbar gutter that can eat
// horizontal space on classic-scrollbar platforms. Fix pairs it with an
// explicit `overflow-y-hidden`. `overflow-x-auto` itself must stay — long/
// many tab sets still need to scroll horizontally (regression guard).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger } from './tabs';

afterEach(() => {
  cleanup();
});

function renderTabList() {
  render(
    <Tabs value="a" onValueChange={() => {}}>
      <TabsList>
        <TabsTrigger value="a">A</TabsTrigger>
        <TabsTrigger value="b">B</TabsTrigger>
      </TabsList>
    </Tabs>,
  );
  return screen.getByRole('tablist');
}

describe('TabsList — no unintended vertical scrollbar (spec-WI-033)', () => {
  it('pairs overflow-x-auto with an explicit overflow-y-hidden', () => {
    const tablist = renderTabList();
    expect(tablist.className).toContain('overflow-x-auto');
    expect(tablist.className).toContain('overflow-y-hidden');
  });
});
