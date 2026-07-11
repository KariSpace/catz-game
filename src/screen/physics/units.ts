import { PIXELS_PER_METER } from '../../shared/config';

// Rapier рахує в метрах, гра малює в пікселях. Конвертація відбувається
// тільки всередині physics/ — назовні не витікає жодного метра.

export const px2m = (px: number): number => px / PIXELS_PER_METER;
export const m2px = (m: number): number => m * PIXELS_PER_METER;
