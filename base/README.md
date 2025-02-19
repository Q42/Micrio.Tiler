# Micrio Tiler base package

This package deals with all tiling logic used by the [Micrio CLI](https://github.com/Q42/Micrio.Tiler/tree/main/CLI) and [GUI](https://github.com/Q42/Micrio.Tiler/tree/main/GUI) tools.

It uses the Micrio APIs to allow you to tile your images on your own hardware, and only upload the resulting tiles to Micrio. In the case of for instance TIFF originals, this could save up to 99% of processing and upload time!

## Dependencies

It uses the [`sharp`](https://www.npmjs.com/package/sharp) NPM package for image processing, which uses [libvips](https://www.libvips.org/).

For (experimental) PDF support, [`pdf-img-convert`](https://www.npmjs.com/package/pdf-img-convert) is used.

## Acknowledgements

* [Erwin Verbruggen](https://github.com/verwinv) for rigorous testing
