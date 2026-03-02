import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { tokens } from '../design-system/tokens';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({
            error,
            errorInfo,
        });
    }

    private handleRetry = () => {
        this.setState({
            hasError: false,
            error: null,
            errorInfo: null,
        });
    };

    public render() {
        if (this.state.hasError) {
            return (
                <View style={styles.container}>
                    <StatusBar style="light" />
                    <View style={styles.content}>
                        <Text style={styles.title}>Something went wrong</Text>
                        <Text style={styles.subtitle}>
                            GTaxi Driver encountered an unexpected error.
                        </Text>

                        <View style={styles.errorBox}>
                            <ScrollView>
                                <Text style={styles.errorText}>
                                    {this.state.error?.toString()}
                                </Text>
                            </ScrollView>
                        </View>

                        <TouchableOpacity
                            style={styles.button}
                            onPress={this.handleRetry}
                            activeOpacity={0.8}
                        >
                            <Text style={styles.buttonText}>Try Again</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            );
        }

        return this.props.children;
    }
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: tokens.colors.background.base,
        justifyContent: 'center',
        padding: 20,
    },
    content: {
        alignItems: 'center',
    },
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        color: tokens.colors.text.primary,
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        color: tokens.colors.text.secondary,
        marginBottom: 24,
        textAlign: 'center',
    },
    errorBox: {
        backgroundColor: tokens.colors.background.ambient,
        padding: 16,
        borderRadius: 8,
        width: '100%',
        maxHeight: 200,
        marginBottom: 24,
        borderWidth: 1,
        borderColor: tokens.colors.border.subtle,
    },
    errorText: {
        color: tokens.colors.status.error,
        fontFamily: 'monospace',
        fontSize: 12,
    },
    button: {
        backgroundColor: tokens.colors.primary.purple, // Driver Emerald
        paddingVertical: 12,
        paddingHorizontal: 32,
        borderRadius: 8,
        width: '100%',
        alignItems: 'center',
    },
    buttonText: {
        color: tokens.colors.text.inverse,
        fontSize: 16,
        fontWeight: '600',
    },
});
