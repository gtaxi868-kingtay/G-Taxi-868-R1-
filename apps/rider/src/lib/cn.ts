import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Merge Tailwind class names; later classes win (shadcn/Reusables pattern).
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
