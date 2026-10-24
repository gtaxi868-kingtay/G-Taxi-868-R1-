import React from 'react';
import { Text as RNText, type TextProps } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

// Six text styles for the whole app. Screens pick a variant instead of
// inventing a size (there were 28 different sizes before).
const textVariants = cva('text-ink', {
    variants: {
        variant: {
            display: 'font-heavy text-[30px] leading-[36px] tracking-[-0.6px]',
            title: 'font-bold text-[22px] leading-[28px] tracking-[-0.3px]',
            headline: 'font-semibold text-[17px] leading-[22px]',
            body: 'font-medium text-[15px] leading-[21px]',
            caption: 'font-medium text-[13px] leading-[18px] text-dim',
            overline: 'font-semibold text-[12px] leading-[16px] text-faint',
        },
    },
    defaultVariants: { variant: 'body' },
});

export type TextVariant = NonNullable<VariantProps<typeof textVariants>['variant']>;

export function Text({ variant, className, ...props }: TextProps & { variant?: TextVariant; className?: string }) {
    return <RNText className={cn(textVariants({ variant }), className)} {...props} />;
}
