/**
 * Picks the v2 (original) or v3 (redesign) version of every screen that has one. The
 * two versions are separate files so either look can be restored without touching the
 * other; pages never import a variant directly — only App.tsx does, through here.
 */
import { V3 } from './design.ts';
import * as shells2 from './shells.tsx';
import * as shells3 from './shells.v3.tsx';
import { Home as Home2 } from '../player/Home.tsx';
import { Home as Home3 } from '../player/Home.v3.tsx';
import { LobbyHero as LobbyHero2 } from '../player/lobby-hero.tsx';
import { LobbyHero as LobbyHero3 } from '../player/lobby-hero.v3.tsx';
import { TableStage as Stage2 } from '../table/TableStage.tsx';
import { TableStage as Stage3, type TableStageProps } from '../table/TableStage.v3.tsx';

export const PlayerShell = V3 ? shells3.PlayerShell : shells2.PlayerShell;
export const ConsoleShell = V3 ? shells3.ConsoleShell : shells2.ConsoleShell;
export const PlatformShell = V3 ? shells3.PlatformShell : shells2.PlatformShell;
export const DemoBar = shells2.DemoBar;
export const Home = V3 ? Home3 : Home2;
export const TableStage: (props: TableStageProps) => ReturnType<typeof Stage3> = V3 ? Stage3 : Stage2;
export const LobbyHero = V3 ? LobbyHero3 : LobbyHero2;
