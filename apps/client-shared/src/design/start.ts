import { AppDefinition } from '../app.js';
import { FlowStore, ScreenDef, ScreenEnv } from '../screen.js';
import { featureStatus, isWired } from '../features.js';
import { NOT_WIRED_PORTS } from '../ports.js';
import { AccountView } from '../screen.js';
import { SAMPLE } from './samples.js';
import { DesignViewer, PreviewContext } from './viewer.js';

// Starts the design preview of an app. Design-only: the live build removes this whole folder.

export interface DesignApp {
  readonly definition: AppDefinition;
  readonly title: string;
  readonly subtitle: string;
  /** Screens that exist only as previews (common states, component gallery, signed-in sample screens). */
  readonly extras: readonly ScreenDef[];
  /** The sample account the preview shows for a screen/variant (undefined = guest). Sample data only. */
  readonly account: (screen: ScreenDef, variant: string) => AccountView | undefined;
}

export function startDesign(root: HTMLElement, app: DesignApp): DesignViewer {
  const viewer = new DesignViewer(root, {
    title: app.title,
    subtitle: app.subtitle,
    frame: 'phone',
    screens: [...app.definition.screens, ...app.extras],
    defaultScreen: app.definition.homeId,
    makeEnv: (context: PreviewContext): ScreenEnv => ({
      mode: 'design',
      brand: app.definition.brand,
      // The preview calls no backend: these ports answer "not wired" and are never reached (preview actions are demos).
      ports: NOT_WIRED_PORTS,
      flows: new FlowStore(),
      account: app.account(context.screen, context.variant),
      go: (id, variant) => context.go(id, variant),
      back: () => context.back(),
      toast: (text) => context.toast(text),
      dialogHost: context.host,
      isWired,
      featureReason: (feature) => featureStatus(feature).reason,
      testSmsNotice: app.definition.testSmsNotice,
      sample: SAMPLE,
    }),
  });
  viewer.mount();
  return viewer;
}
