import { ArrowDown, ArrowUp, Droplets, Hand, Repeat, Zap, createElement, type IconNode } from 'lucide';
import type { InputManager } from '../game/InputManager';
import { el } from './HUD';

/**
 * On-screen controls for phones and tablets: a virtual joystick on the left, action buttons on the
 * right, and dragging anywhere else on the right half turns the camera.
 * Only shown on touch-first devices (coarse pointer).
 */
export class TouchControls {
  static wanted(): boolean {
    return window.matchMedia?.('(pointer: coarse)').matches ?? false;
  }

  constructor(root: HTMLElement, input: InputManager) {
    document.body.classList.add('touch');
    const layer = el('div', 'touch-layer');
    const base = el('div', 'stick-base');
    const knob = el('div', 'stick-knob');
    base.append(knob);
    layer.append(base);

    // Joystick
    let stickId: number | null = null;
    let origin = { x: 0, y: 0 };
    const R = 55;
    base.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId;
      base.setPointerCapture(e.pointerId);
      const r = base.getBoundingClientRect();
      origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      move(e);
    });
    const move = (e: PointerEvent) => {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - origin.x;
      let dy = e.clientY - origin.y;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        dx = (dx / len) * R;
        dy = (dy / len) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.setTouchStick(dx / R, -dy / R);
    };
    base.addEventListener('pointermove', move);
    const release = (e: PointerEvent) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      knob.style.transform = '';
      input.setTouchStick(0, 0);
    };
    base.addEventListener('pointerup', release);
    base.addEventListener('pointercancel', release);

    // Buttons
    const pad = el('div', 'touch-buttons');
    const button = (name: string, node: IconNode, label: string, cls = '') => {
      const b = el('button', `tbtn ${cls}`, createElement(node, { width: 22, height: 22, 'stroke-width': 2.4 }), el('span', '', label));
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        input.touchButton(name, true);
      });
      const up = () => {
        b.classList.remove('down');
        input.touchButton(name, false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      pad.append(b);
    };
    button('Fire', Droplets, 'Spray', 'big');
    button('Jump', ArrowUp, 'Jump');
    button('Act', Hand, 'Use');
    button('Boost', Zap, 'Boost');
    button('Down', ArrowDown, 'Down');
    button('Mode', Repeat, 'Mode');
    layer.append(pad);

    // Camera look: drag on the right half of the screen
    const look = el('div', 'touch-look');
    let lookId: number | null = null;
    let last = { x: 0, y: 0 };
    look.addEventListener('pointerdown', (e) => {
      lookId = e.pointerId;
      look.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
    });
    look.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      input.addLook((e.clientX - last.x) * 1.6, (e.clientY - last.y) * 1.6);
      last = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === lookId) lookId = null;
    };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    root.prepend(look);
    root.append(layer);
  }
}
