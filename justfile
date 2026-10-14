default:
    @just --list

# Open an isolated GNOME desktop for manual testing (Wayland + Mutter Devkit).
gnome:
    pnpm exec vp run gnome
