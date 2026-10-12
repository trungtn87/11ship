import { AppDefinition } from '../app.js';
import { staticConnection } from '../connection.js';
import { LeaveController } from '../leave.js';
import { FlowStore, ScreenDef, ScreenEnv } from '../screen.js';
import { featureStatus, isWired } from '../features.js';
import { NOT_WIRED_PORTS } from '../ports.js';
import { AccountView } from '../screen.js';
import { connectionFixture, SAMPLE } from './samples.js';
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
  // C08 in the preview: the same rule as the real app for the buttons of the phone frame (the preview's own toolbar is not a screen).
  const leave = new LeaveController();
  const viewer = new DesignViewer(root, {
    title: app.title,
    subtitle: app.subtitle,
    frame: 'phone',
    screens: [...app.definition.screens, ...app.extras],
    defaultScreen: app.definition.homeId,
    makeEnv: (context: PreviewContext): ScreenEnv => {
      leave.clear();
      return {
        mode: 'design',
        brand: app.definition.brand,
        // The preview calls no backend: these ports answer "not wired" and are never reached (preview actions are demos).
        ports: NOT_WIRED_PORTS,
        flows: new FlowStore(),
        account: app.account(context.screen, context.variant),
        go: (id, variant) => leave.request(() => context.go(id, variant), context.host),
        back: () => leave.request(() => context.back(), context.host),
        guard: (guard) => leave.register(guard),
        toast: (text) => context.toast(text),
        dialogHost: context.host,
        // A fixed example, never a real check: the preview calls no server. Only the diagnostics screen reads its variant.
        connection: staticConnection(connectionFixture(context.screen.id === 'diagnostics' ? context.variant : 'default', app.definition.brand.id === 'FOOD' ? 'food-web' : 'ship-web')),
        isWired,
        featureReason: (feature) => featureStatus(feature).reason,
        testSmsNotice: app.definition.testSmsNotice,
        sample: SAMPLE,
      };
    },
  });
  viewer.mount();
  return viewer;
}
