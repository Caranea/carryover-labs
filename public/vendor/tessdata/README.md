# Orientation detection data

`osd.traineddata.gz` is the gzip-compressed orientation/script detector from
https://github.com/tesseract-ocr/tessdata/blob/4.1.0/osd.traineddata
(Apache-2.0, Tesseract contributors).

It is not loaded by the current pipeline, which reads each page in a single pass without
orientation detection. Polish, German and English OCR data come from npm packages.
