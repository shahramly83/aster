// Catches any render/runtime error in the tree and shows it on screen instead
// of letting the app crash to the home screen. Invaluable for diagnosing a
// release build on a device with no debugger attached.
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
  }

  render() {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <View style={styles.wrap}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Nur Quran hit an error</Text>
          <Text style={styles.subtitle}>Please screenshot this and share it.</Text>
          <Text style={styles.msg}>{String(error?.message || error)}</Text>
          {!!error?.stack && <Text style={styles.stack}>{error.stack}</Text>}
          {!!info?.componentStack && <Text style={styles.stack}>{info.componentStack}</Text>}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0B1512' },
  content: { padding: 24, paddingTop: 64 },
  title: { color: '#E27676', fontSize: 20, fontWeight: '800' },
  subtitle: { color: '#93A29B', fontSize: 13, marginTop: 6, marginBottom: 16 },
  msg: { color: '#EDF2EF', fontSize: 14, fontWeight: '600', marginBottom: 16 },
  stack: { color: '#93A29B', fontSize: 11, fontFamily: 'monospace', marginTop: 8 },
});
