import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface Props {
  children: ReactNode;
  moduleName: string;
}

interface State {
  hasError: boolean;
  errorText: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorText: ''
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorText: error.message };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary] ${this.props.moduleName}:`, error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorText: '' });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0A0A12', justifyContent: 'center', alignItems: 'center' }}>
          <View style={{ width: '85%', padding: 24, backgroundColor: '#121220', borderRadius: 12, borderWidth: 1, borderColor: '#3A1F5D', alignItems: 'center' }}>
            <Text style={{ color: '#00F2FE', fontSize: 14, fontWeight: '900', letterSpacing: 2, marginBottom: 16 }}>G-TAXI GROUND CONTROL</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '600', textAlign: 'center', marginBottom: 12 }}>
              An unexpected runtime error occurred in {this.props.moduleName}.
            </Text>
            <Text style={{ color: '#FF4A85', fontSize: 11, fontFamily: 'monospace', backgroundColor: '#1A0B14', padding: 12, borderRadius: 6, marginBottom: 20, width: '100%' }}>
              {this.state.errorText}
            </Text>
            <TouchableOpacity
              onPress={this.handleReset}
              style={{ backgroundColor: '#7F00FF', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 8 }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 13, fontWeight: '700', letterSpacing: 1 }}>RESET WORKSPACE VIEW</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}
