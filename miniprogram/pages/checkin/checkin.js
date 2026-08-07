const { detectFace } = require('../../utils/tracking-face-detector')

const DETECT_EVERY_N_FRAMES = 5
const CENTER_STREAK_TARGET = 3
const CENTER_TOLERANCE_X = 0.18
const CENTER_TOLERANCE_Y = 0.22
const FACE_SIZE_MIN_RATIO = 0.22
const FACE_SIZE_MAX_RATIO = 0.72
const RING_CENTER_OFFSET_RPX = 62

Page({
  data: {
    statusText: '等待相机初始化',
    cameraReady: false,
    capturing: false,
    detecting: false,
    detectFrameCount: 0,
    lastCapturePath: '',
    lastFaceBoxText: ''
  },

  onLoad() {
    this.centerHitStreak = 0
    this.pendingDetect = false
    this.autoCaptured = false
    this.frameStartRetryCount = 0
    this.hasReceivedFrame = false
    this.pageReady = false
    this.cameraInitDone = false
    this.isPageActive = true
    this.frameRetryTimer = null
    this.captureCenterY = this.getCaptureCenterY()
  },

  onReady() {
    this.pageReady = true
    this.createCameraContextAndStart()
  },

  onShow() {
    this.isPageActive = true
    this.hasReceivedFrame = false
    this.createCameraContextAndStart()
  },

  onUnload() {
    this.isPageActive = false
    this.stopFrameListener()
  },

  onHide() {
    this.isPageActive = false
    this.stopFrameListener()
  },

  handleCameraReady() {
    this.cameraInitDone = true
    this.setData({
      cameraReady: true,
      statusText: '相机已就绪，开始自动检测人脸'
    })
    this.createCameraContextAndStart()
  },

  handleCameraError(event) {
    console.error('camera error', event)
    this.stopFrameListener()
    this.setData({
      cameraReady: false,
      detecting: false,
      statusText: '相机启动失败，请检查权限'
    })
  },

  goBack() {
    this.isPageActive = false
    this.stopFrameListener()
    wx.navigateBack()
  },

  createCameraContextAndStart() {
    if (!this.isPageActive || !this.pageReady || !this.cameraInitDone || this.listenerStarted) {
      return
    }

    this.cameraContext = wx.createCameraContext()
    this.startFrameListener()
  },

  startFrameListener() {
    if (!this.cameraContext || this.listenerStarted) {
      return
    }

    if (!this.cameraContext.onCameraFrame) {
      this.setData({
        detecting: false,
        statusText: '当前基础库不支持自动检测，请升级微信或基础库'
      })
      return
    }

    const frameListener = this.cameraContext.onCameraFrame((frame) => {
      if (!this.isPageActive || !this.listenerStarted) {
        return
      }
      this.handleCameraFrame(frame)
    })

    this.frameListener = frameListener
    this.listenerStarted = true
    this.setData({
      detecting: false,
      statusText: '正在启动自动检测...'
    })

    try {
      frameListener.start({
        fail: (error) => {
          console.error('frame listener start fail', error)
          this.listenerStarted = false
          this.frameListener = null

          if (error && error.errMsg && error.errMsg.indexOf('camera is not found') !== -1 && this.frameStartRetryCount < 5) {
            this.frameStartRetryCount += 1
            this.frameRetryTimer = setTimeout(() => {
              this.frameRetryTimer = null
              this.createCameraContextAndStart()
            }, 300)
            return
          }

          this.setData({
            detecting: false,
            statusText: '自动检测启动失败，请退出后重试'
          })
        }
      })
    } catch (error) {
      console.error('frame listener start throw', error)
      this.listenerStarted = false
      this.frameListener = null
      this.setData({
        detecting: false,
        statusText: '自动检测启动失败，请退出后重试'
      })
    }
  },

  stopFrameListener() {
    this.frameStartRetryCount = 0
    this.pendingDetect = false

    if (this.frameRetryTimer) {
      clearTimeout(this.frameRetryTimer)
      this.frameRetryTimer = null
    }

    if (!this.frameListener || !this.listenerStarted) {
      this.setData({
        detecting: false
      })
      return
    }

    this.listenerStarted = false
    this.setData({
      detecting: false
    })
    this.frameListener.stop({
      complete: () => {
        this.listenerStarted = false
        this.frameListener = null
        this.pendingDetect = false
        this.setData({
          detecting: false
        })
      }
    })
  },

  handleCameraFrame(frame) {
    if (!this.isPageActive || !this.listenerStarted) {
      return
    }

    if (!this.hasReceivedFrame) {
      this.hasReceivedFrame = true
      this.frameStartRetryCount = 0
      this.setData({
        detecting: true,
        statusText: '正在自动检测人脸位置...'
      })
    }

    if (this.pendingDetect || this.data.capturing || this.autoCaptured) {
      return
    }

    const nextFrameCount = this.data.detectFrameCount + 1
    this.setData({
      detectFrameCount: nextFrameCount
    })

    if (nextFrameCount % DETECT_EVERY_N_FRAMES !== 0) {
      return
    }

    this.pendingDetect = true

    Promise.resolve(this.detectFaceBox(frame))
      .then((result) => {
        this.pendingDetect = false
        if (!this.isPageActive || !this.listenerStarted) {
          return
        }
        this.applyDetectionResult(result)
      })
      .catch((error) => {
        this.pendingDetect = false
        if (!this.isPageActive || !this.listenerStarted) {
          return
        }
        console.error('detectFaceBox fail', error)
        this.centerHitStreak = 0
        this.setData({
          statusText: '人脸检测异常，请稍后重试'
        })
      })
  },

  detectFaceBox(frame) {
    const { width, height } = frame
    console.log('cameraFrame(sample)', {
      width,
      height,
      dataLength: frame.data ? frame.data.byteLength : 0
    })

    const result = detectFace(frame, {
      maxWidth: 160,
      maxHeight: 160,
      initialScale: 1,
      scaleFactor: 1.2,
      stepSize: 1.5,
      edgesDensity: 0.08
    })

    if (result.found) {
      console.log('trackingFaceBox', {
        box: result.box,
        raw: result.raw && result.raw.bestRect,
        candidates: result.raw && result.raw.rects ? result.raw.rects.length : 0
      })
    }

    return Promise.resolve(result)
  },

  applyDetectionResult(result) {
    if (!this.isPageActive || !this.listenerStarted || this.autoCaptured) {
      return
    }

    if (!result || !result.found || !result.box) {
      this.centerHitStreak = 0
      this.setData({
        lastFaceBoxText: '',
        statusText: '未检测到人脸，请正对镜头并将脸移入圆形区域'
      })
      return
    }

    const { box } = result
    const centered = this.isFaceCentered(box)
    this.setData({
      lastFaceBoxText: this.formatFaceBox(box),
      statusText: centered ? '检测到人脸，继续保持不动...' : '检测到人脸，请移动到圆形区域中央'
    })

    if (!centered) {
      this.centerHitStreak = 0
      return
    }

    this.centerHitStreak += 1

    if (this.centerHitStreak >= CENTER_STREAK_TARGET) {
      this.autoCaptured = true
      this.centerHitStreak = 0
      this.captureFrame(true)
    }
  },

  isFaceCentered(box) {
    const centerX = box.x + box.width / 2
    const centerY = box.y + box.height / 2
    const widthRatio = box.width
    const heightRatio = box.height
    const targetCenterY = this.captureCenterY || 0.54

    const offsetX = Math.abs(centerX - 0.5)
    const offsetY = Math.abs(centerY - targetCenterY)

    return offsetX <= CENTER_TOLERANCE_X
      && offsetY <= CENTER_TOLERANCE_Y
      && widthRatio >= FACE_SIZE_MIN_RATIO
      && widthRatio <= FACE_SIZE_MAX_RATIO
      && heightRatio >= FACE_SIZE_MIN_RATIO
      && heightRatio <= FACE_SIZE_MAX_RATIO
  },

  getCaptureCenterY() {
    const systemInfo = wx.getSystemInfoSync()
    const rpxToPx = systemInfo.windowWidth / 750
    const offsetPx = RING_CENTER_OFFSET_RPX * rpxToPx

    return (systemInfo.windowHeight / 2 + offsetPx) / systemInfo.windowHeight
  },

  formatFaceBox(box) {
    return `x:${box.x.toFixed(2)} y:${box.y.toFixed(2)} w:${box.width.toFixed(2)} h:${box.height.toFixed(2)}`
  },

  retakeFrame() {
    if (this.data.capturing) {
      return
    }

    this.autoCaptured = false
    this.centerHitStreak = 0
    this.pendingDetect = false
    this.setData({
      lastCapturePath: '',
      lastFaceBoxText: '',
      statusText: ''
    })
  },

  captureFrame(isAuto = false, textOptions = {}) {
    if (this.data.capturing || !this.cameraContext) {
      return
    }

    this.setData({
      capturing: true,
      statusText: textOptions.capturingText || (isAuto ? '检测命中，正在自动抓拍...' : '正在抓取当前画面...')
    })

    this.cameraContext.takePhoto({
      quality: 'high',
      success: ({ tempImagePath }) => {
        if (!this.isPageActive) {
          return
        }
        console.log('tempImagePath', tempImagePath)
        this.readFileAsBase64(tempImagePath)
        this.setData({
          lastCapturePath: tempImagePath,
          statusText: textOptions.successText || (isAuto ? '自动抓拍成功，已输出路径和 base64' : '抓拍成功，已输出路径和 base64')
        })
      },
      fail: (error) => {
        if (!this.isPageActive) {
          return
        }
        console.error('takePhoto fail', error)
        this.autoCaptured = false
        this.setData({
          statusText: '抓拍失败，请重试'
        })
      },
      complete: () => {
        if (!this.isPageActive) {
          return
        }
        this.setData({
          capturing: false
        })
      }
    })
  },

  readFileAsBase64(filePath) {
    const fileSystemManager = wx.getFileSystemManager()

    fileSystemManager.readFile({
      filePath,
      encoding: 'base64',
      success: ({ data }) => {
        if (!this.isPageActive) {
          return
        }
        console.log('imageBase64', data)
      },
      fail: (error) => {
        if (!this.isPageActive) {
          return
        }
        console.error('readFile base64 fail', error)
      }
    })
  }
})
