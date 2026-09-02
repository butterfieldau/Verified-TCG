import fs from 'node:fs';
import path from 'node:path';

const appDirectory = path.resolve(__dirname, '..', 'app');
const readAppFile = (...segments: string[]) =>
  fs.readFileSync(path.join(appDirectory, ...segments), 'utf8');

describe('authenticated navigation contract', () => {
  it('enters through splash and keeps the authenticated tab shell as the root route', () => {
    const entrySource = readAppFile('index.tsx');
    const splashSource = readAppFile('splash.tsx');
    const rootLayoutSource = readAppFile('_layout.tsx');

    expect(entrySource).toContain('<Redirect href="/splash" />');
    expect(splashSource).toContain('resolveInitialRoute(');
    expect(splashSource).toContain('router.replace(destination)');

    expect(rootLayoutSource).toMatch(
      /<Stack\.Screen[\s\S]*?name="\(tabs\)"[\s\S]*?gestureEnabled:\s*false[\s\S]*?animation:\s*'none'/,
    );
    expect(rootLayoutSource.match(/name="\(tabs\)"/g)).toHaveLength(1);
  });

  it('keeps Home first and exposes Community only as an intentional tab route', () => {
    const tabLayoutSource = readAppFile('(tabs)', '_layout.tsx');
    const tabRouteNames = [
      ...tabLayoutSource.matchAll(/(?:NativeTabs\.Trigger|Tabs\.Screen)\s+name="([^"]+)"/g),
    ].map(match => match[1]);

    expect(tabRouteNames).toEqual([
      'index',
      'market',
      'collection',
      'community',
      'profile',
      'index',
      'market',
      'collection',
      'community',
      'profile',
    ]);
    expect(tabLayoutSource).toContain('<Label>Home</Label>');
    expect(tabLayoutSource).toContain('<Label>Community</Label>');
    expect(fs.existsSync(path.join(appDirectory, 'community.tsx'))).toBe(false);
  });

  it('uses replacement navigation into the tab shell after sign-in and onboarding', () => {
    const signInSource = readAppFile('sign-in.tsx');
    const onboardingSource = readAppFile('onboarding.tsx');

    expect(signInSource).toMatch(/router\.replace\([\s\S]*\?\?\s*'\/\(tabs\)'/);
    expect(onboardingSource.match(/router\.replace\('\/\(tabs\)'\)/g)).toHaveLength(2);
  });
});