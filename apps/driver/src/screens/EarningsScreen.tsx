import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export function EarningsScreen() {
    return (
        <View style={styles.container}>
            <Text style={styles.text}>Earnings History Coming Soon</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    text: {
        fontSize: 18,
        color: '#666',
    }
});
