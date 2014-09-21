var five = require('johnny-five'),
    pngparse = require('pngparse'),
    floydSteinberg = require('floyd-steinberg'),
    pngtolcd = require('png-to-lcd'),
    board = new five.Board();

// new blank buffer
var buffer = new Buffer(512);
buffer.fill(0x00);

// create command buffers
var OLED = {};
OLED.HEIGHT = 32;
OLED.WIDTH = 128;
OLED.ADDRESS = 0x3C;
OLED.DISPLAY_OFF = 0xAE;
OLED.DISPLAY_ON = 0xAF;
OLED.SET_DISPLAY_CLOCK_DIV = 0xD5;
OLED.SET_MULTIPLEX = 0xA8;
OLED.SET_DISPLAY_OFFSET = 0xD3;
OLED.SET_START_LINE = 0x0;
OLED.CHARGE_PUMP = 0x8D;
OLED.EXTERNAL_VCC = false;
OLED.MEMORY_MODE = 0x20;
OLED.SEG_REMAP = 0xA0;
OLED.COM_SCAN_DEC = 0xC8;
OLED.COM_SCAN_INC = 0xC0;
OLED.SET_COM_PINS = 0xDA;
OLED.SET_CONTRAST = 0x81;
OLED.SET_PRECHARGE = 0xd9;
OLED.SET_VCOM_DETECT = 0xDB;
OLED.DISPLAY_ALL_ON_RESUME = 0xA4;
OLED.NORMAL_DISPLAY = 0xA6;
OLED.COLUMN_ADDR = 0x21;
OLED.PAGE_ADDR = 0x22;
OLED.INVERT_DISPLAY = 0xA7;
OLED.ACTIVATE_SCROLL = 0x2F;
OLED.DEACTIVATE_SCROLL = 0x2E;
OLED.SET_VERTICAL_SCROLL_AREA = 0xA3;
OLED.RIGHT_HORIZONTAL_SCROLL = 0x26;
OLED.LEFT_HORIZONTAL_SCROLL = 0x27;
OLED.VERTICAL_AND_RIGHT_HORIZONTAL_SCROLL = 0x29;
OLED.VERTICAL_AND_LEFT_HORIZONTAL_SCROLL = 0x2A;

// writes both commands and data buffers to the OLED device
function writeI2C(type, val) {
  var control;
  if (type === 'data') {
    control = 0x40;
  } else if (type === 'cmd') {
    control = 0x00;
  } else {
    return;
  }
  // send control and actual val
  board.io.sendI2CWriteRequest(OLED.ADDRESS, [control, val]);
}

// read a byte from the oled
function readI2C(fn) {
  board.io.sendI2CReadRequest(OLED.ADDRESS, 1, function(data) {
    fn(data);
  });
}

function waitUntilReady(callback) {
  var done;
  // TODO: attempt to use setImmediate
  setTimeout(function tick() {
    readI2C(function (byte) {
      done = byte << 7;
      if (done) {
        callback();
      } else {
        setTimeout(tick, 0);
      }
    });
  }, 0);
}

function init() {
  // enable i2C in firmata
  board.io.sendI2CConfig(0);

  // set up the display so it knows what to do
  var initSeq = [
    OLED.DISPLAY_OFF,
    OLED.SET_DISPLAY_CLOCK_DIV, 0x80,
    OLED.SET_MULTIPLEX, 0x1F,
    OLED.SET_DISPLAY_OFFSET, 0x0, // sets offset pro to 0
    OLED.SET_START_LINE,
    OLED.CHARGE_PUMP, 0x14, // charge pump val
    OLED.MEMORY_MODE, 0x00, // 0x0 act like ks0108
    OLED.SEG_REMAP, // screen orientation
    OLED.COM_SCAN_INC, // screen orientation
    OLED.SET_COM_PINS, 0x02, // com pins val
    OLED.SET_CONTRAST, 0x8F, // contrast val
    OLED.SET_PRECHARGE, 0xF1, // precharge val
    OLED.SET_VCOM_DETECT, 0x40, // vcom detect
    OLED.DISPLAY_ALL_ON_RESUME,
    OLED.NORMAL_DISPLAY,
    OLED.DISPLAY_ON
  ];

  var i, initSeqLen = initSeq.length;

  // write init seq commands
  for (i = 0; i < initSeqLen; i ++) {
    writeI2C('cmd', initSeq[i]);
  }
}

function display() {
  // TODO: either keep this, or push asynchronous handling onto the consumer
  waitUntilReady(function() {
    console.log('display is now ready!')
    var displaySeq = [
      OLED.COLUMN_ADDR, 0, OLED.WIDTH - 1, // column start and end address 
      OLED.PAGE_ADDR, 0, 3 // page start and end address
    ];

    var displaySeqLen = displaySeq.length,
        bufferLen = buffer.length,
        i, v;

    // send intro seq
    for (i = 0; i < displaySeqLen; i += 1) {
      writeI2C('cmd', displaySeq[i]);
    }

    // write buffer data
    for (v = 0; v < bufferLen; v += 1) {
      writeI2C('data', buffer[v]);
    }

  });
}

function dimDisplay(bool) {
  var contrast;

  if (bool) {
    contrast = 0; // Dimmed display
  } else {
    contrast = 0xCF; // High contrast
  }

  writeI2C('cmd', OLED.SET_CONTRAST);
  writeI2C('cmd', contrast);
}

function clearDisplay() {
  buffer = new Buffer(512);
  // write black pixels
  buffer.fill(0x00);

  // allow chaining
  return this;
}

function invertDisplay(bool) {
  if (bool) {
    writeI2C('cmd', OLED.INVERT_DISPLAY);
  } else {
    writeI2C('cmd', OLED.NORMAL_DISPLAY);
  }
}

function drawBitmap(pixels) {
  var x, y;
  var pixelArray = [];
  console.log(pixels.length);

  for (var i = 0; i < pixels.length; i++) {
    x = Math.floor(i % OLED.WIDTH) + 1;
    y = Math.floor(i / OLED.WIDTH) + 1;

    drawPixel([[x, y, pixels[i]]]);
  }
  // I like the idea of allowing chaining for display()
  // TODO: either keep this, or push asynchronous handling onto the consumer
  return this;
}

function drawPixel(pixels) {
  pixels.forEach(function(el) {
    // return if the pixel is out of range
    var x = el[0], y = el[1], color = el[2];
    if (x > OLED.WIDTH || y > OLED.HEIGHT) return;

    // thanks, Martin Richards
    x -= 1; y -=1;
    var byte = 0,
        page = Math.floor(y / 8),
        pageShift = 0x01 << (y - 8 * page);

    // is the pixel on the first row of the page?
    (page == 0) ? byte = x : byte = x + OLED.WIDTH * page; 

      // colors! Well, monochrome.
    
      if (color === 'BLACK' || color === 0) {
        buffer[byte] &= ~pageShift;
      }
      if (color === 'WHITE' || color > 0) {
        buffer[byte] |= pageShift;
      }

    // sanity check
    // console.log(color + ' pixel at ' + x + ', ' + y);
  });

  // I like the idea of allowing chaining for display()
  // TODO: either keep this, or push asynchronous handling onto the consumer
  return this;
}

// using Bresenham's line algorithm
function drawLine(x0, y0, x1, y1) {
  var dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  var dy = Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  var err = (dx > dy ? dx : -dy) / 2;
  while (true) {
    drawPixel([[x0, y0, 1]]);
    if (x0 === x1 && y0 === y1) break;
    var e2 = err;
    if (e2 > -dx) {err -= dy; x0 += sx;}
    if (e2 < dy) {err += dx; y0 += sy;}
  }
}

// activate a right handed scroll for rows start through stop
function startscrollright(start, stop) {
  // TODO: either keep this, or push asynchronous handling onto the consumer
  waitUntilReady(function() {
    var cmdSeq = [
      OLED.RIGHT_HORIZONTAL_SCROLL,
      0X00, start,
      0X00, stop,
      0X00, 0XFF,
      OLED.ACTIVATE_SCROLL
    ];

    var i, cmdSeqLen = cmdSeq.length;

    for (i = 0; i < cmdSeqLen; i += 1) {
      writeI2C('cmd', cmdSeq[i]);
    }
  });
}

function stopscroll() {
  writeI2C('cmd', OLED.DEACTIVATE_SCROLL);
}

board.on('ready', function() {
  console.log('I see you, board');
  
  // send setup sequence to OLED
  init();

  stopscroll();

  // clear first just in case
  clearDisplay();
  display();

  // draw some test pixels in each corner limit
  // drawPixel([
  //   [128, 1, 'WHITE'],
  //   [128, 32, 'WHITE'],
  //   [128, 16, 'WHITE'],
  //   [64, 16, 'WHITE']
  // ]).display();

  dimDisplay(true);

  // // testing out my new module
  pngtolcd(__dirname + '/bitmaps/cat.png', true, function(err, bitmapbuf) {
      buffer = bitmapbuf;
      display();
  });

  // drawLine(1, 1, 128, 32);
  // drawLine(64, 16, 128, 16);
  // drawLine(1, 10, 40, 10);
  // drawLine(64, 0, 64, 32);
  // display();

  // /pass in an existing monochrome indexed image, then display
  // pngparse.parseFile(__dirname + '/bitmaps/parrot-index.png', function(err, image) {
  //   drawBitmap(image.data);
  //   display();
  // });

  // assign exisiting image buffer and display
  // buffer = adafruitLogo;
  // display();

  // dim the display
  //dimDisplay(true);

  // invert display
  //invertDisplay(true);

  // scroll right
  // startscrollright(0x00, 0x0F);

  // clear display
  //clearDisplay();

});  