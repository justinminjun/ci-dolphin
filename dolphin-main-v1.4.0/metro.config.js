// Learn more https://docs.expo.dev/guides/monorepos/#modify-the-metro-config
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// `react-native-maps` has no web implementation and hard-fails Metro's web
// bundle (it imports react-native internals that don't exist on web). Alias
// it to a web-compatible shim for web builds only — native platforms resolve
// the real package unchanged. See src/utils/ReactNativeMapsWebShim.tsx.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (platform === 'web' && moduleName === 'react-native-maps') {
        return {
            filePath: path.resolve(__dirname, 'src/utils/ReactNativeMapsWebShim.tsx'),
            type: 'sourceFile',
        };
    }
    if (originalResolveRequest) {
        return originalResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
