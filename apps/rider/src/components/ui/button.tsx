import React from 'react';
import { Pressable, type PressableProps, View } from 'react-native';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { Text } from './text';

// Primary = soft white pill (calm, premium); brand = the purple accent for
// the one action that matters on a screen; ghost = quiet secondary.
const buttonVariants = cva('flex-row items-center justify-center rounded-full active:opacity-80', {
    variants: {
        variant: {
            primary: 'bg-ink',
            brand: 'bg-brand',
            ghost: 'bg-raised',
        },
        size: {
            lg: 'h-14 px-6',
            md: 'h-11 px-5',
            sm: 'h-9 px-4',
        },
    },
    defaultVariants: { variant: 'primary', size: 'lg' },
});

const labelColor: Record<string, string> = { primary: 'text-bg', brand: 'text-ink', ghost: 'text-ink' };

type Props = PressableProps & VariantProps<typeof buttonVariants> & {
    label: string;
    icon?: React.ReactNode;
    className?: string;
};

export function Button({ label, icon, variant = 'primary', size = 'lg', className, ...props }: Props) {
    return (
        <Pressable accessibilityRole="button" className={cn(buttonVariants({ variant, size }), className)} {...props}>
            {icon ? <View className="mr-2">{icon}</View> : null}
            <Text variant="headline" className={cn(labelColor[variant ?? 'primary'])}>{label}</Text>
        </Pressable>
    );
}
