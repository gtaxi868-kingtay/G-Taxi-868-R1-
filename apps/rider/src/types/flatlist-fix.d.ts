import { ScrollViewProps } from 'react-native';

declare module 'react-native' {
    interface FlatListProps<ItemT> extends ScrollViewProps {}
}
