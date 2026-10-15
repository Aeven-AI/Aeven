# Agent Note: Background mode on by default, with a larger menu bar icon

Status: implemented

English | [中文](2026-10-15-background-mode-default-and-menu-bar-icon.zh.md)

## Problem

The desktop shell could keep running after its last window closed, but only once the reader found **Run in the background** in General Settings and turned it on. Someone who never opened that row closed the window, saw the screen empty itself, and read the application as quit — while the shell and the Host it launched kept serving loopback port 3080, with no icon anywhere that named the running process or offered a way to stop it. The menu bar icon the mode creates was a 16 px template whose mark covered 14 points, lighter than the items beside it, so even an enabled mode was easy to miss.

## Decision

Background mode is on unless the installation says otherwise. `readEnabled` returns true when `background-mode.json` is absent — the state of a fresh install and of any install that never touched the row — while a stored record still wins, so turning the mode off is sticky. A record that cannot be parsed reads as off rather than as the default, because the value that was lost may be the reader's own choice to stop the shell. The client seeds its snapshot store with true so the Settings row never reports off before the preload bridge answers.

The macOS menu bar template is rendered from `trayTemplate.svg` onto a 19-point canvas (`trayTemplate.png` at 19 px, `trayTemplate@2x.png` at 38 px), with the mark filling 18 × 15.5 points. Measured on the display under test, that mark draws 18 × 15 points against 16 × 15.5 for the neighbouring third-party icon. A 16-point template drew a mark that read smaller than its neighbour and a 22-point one — the largest canvas macOS accepts, since it fixes a menu bar extra's working area at 22 points — read larger, so the shipped size sits between them. Windows keeps `tray-windows.ico`, whose icon resource already carries 16–64 px, and Linux keeps `linux/icons/24x24.png`. A development run reads `resources/` from disk, so a re-rendered template appears the next time the shell builds its icon, without a rebuild.

## Consequences

A fresh installation now keeps a shell, and through it a Host, alive after its last window closes: on macOS the Dock icon hides until a window opens again, and the process ends only through **Quit Aeven** from the icon or the application menu, or through a quit that the ordinary confirmation path completes. The template sits 2.5 points below the largest canvas macOS accepts for a menu bar extra, so the mark reads at the weight of the icon beside it rather than as the largest item in the bar.

`apps/desktop/tests/background-mode.spec.ts` pins the behavior: the default when no record exists, both stored values, an unreadable record reading as off, the icon following the choice, and the change reported to listeners.

## Alternatives considered

### Keep the opt-in and only enlarge the icon

Rejected. The screen the reader reported was not "the icon is small" but "the application is gone while 3080 still answers"; a larger icon that appears only after the same discoverable switch leaves that report intact.

### Show the icon whenever the shell runs, not only in background mode

Rejected. The tray exists because the shell can outlive its window; an icon that is always present would offer a quit that ends nothing while a window is open, and would put a second affordance beside the application menu.

### Resize the 16 px template at runtime

Rejected. Every desktop raster is rendered from the SVG beside it at its own edge length; scaling a 16 px mark up at runtime would show the interpolation, and would leave the shipped asset smaller than what the code displays.

### Set the mark to the 16-point size the platform guidance names

Rejected. Sixteen points is the guidance for a circular mark that should carry the same weight as a system item; this mark is wide, open, and thin-stroked, so it reads lighter than its box, and the reader's own benchmark was the application icon beside it.
