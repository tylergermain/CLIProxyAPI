// Package console embeds the Friday Proxy web console served at /console.
package console

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed assets
var assets embed.FS

// FileSystem returns the console's static assets rooted at the assets directory.
func FileSystem() (http.FileSystem, error) {
	sub, err := fs.Sub(assets, "assets")
	if err != nil {
		return nil, err
	}
	return http.FS(sub), nil
}
