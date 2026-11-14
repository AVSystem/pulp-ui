import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useLocation } from 'react-router';
import { Breadcrumbs } from 'src/components/breadcrumbs';
import { currentScreen, useMenuModel } from 'src/menu';

// What the screen in the page tells the top bar: its own trail, if it has
// one, and its title as the fallback.
interface ISlot {
  trail: ReactNode;
  title: string;
}

const SlotContext = createContext<ISlot | null>(null);

// The writing side has its own context. Its value never changes, so a screen
// that writes into the slot is not rendered again when the slot changes.
const WriterContext = createContext<(slot: ISlot | null) => void>(
  () => undefined,
);

export const BreadcrumbSlotProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [slot, setSlot] = useState<ISlot | null>(null);

  return (
    <WriterContext.Provider value={setSlot}>
      <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>
    </WriterContext.Provider>
  );
};

// For the screen's header: puts the trail and title into the top bar while the
// screen is shown and takes them out again when it goes away. Outside the
// shell it does nothing.
export function useBreadcrumbSlot(trail: ReactNode, title: string) {
  const write = useContext(WriterContext);

  useEffect(() => {
    write({ trail, title });
    return () => write(null);
  }, [write, trail, title]);
}

// The trail in the top bar: the one the screen declared, or a single crumb
// named like the screen's sidebar entry (the screen's title when no entry
// leads to it).
export const BreadcrumbBar = () => {
  const slot = useContext(SlotContext);
  const { screens } = useMenuModel();
  const { pathname } = useLocation();

  const label = currentScreen(screens, pathname)?.label ?? slot?.title;

  return (
    <div className='pulp-topbar__crumbs'>
      {slot?.trail ??
        (label ? <Breadcrumbs links={[{ name: label }]} /> : null)}
    </div>
  );
};
