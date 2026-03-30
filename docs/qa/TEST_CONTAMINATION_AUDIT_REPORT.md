🛡️  TEST CONTAMINATION RISK AUDIT REPORT
======================================================================
📊 SUMMARY:
   🔴 Risky files: 20
   ✅ Safe files: 35
   📝 Total risks found: 267

📈 RISK BREAKDOWN:
   🔸 real_path_usage: 243 instances
   🔸 home_directory_access: 15 instances
   🔸 config_file_creation: 9 instances

🔍 DETAILED RISKS BY FILE:

📁 tests\test_ai_service.py
---------------------------
   🔴 Line 251: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = provider.transcribe_audio("/nonexistent/file.wav")

📁 tests\test_audio_player_enhanced.py
--------------------------------------
   🔴 Line 54: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track = AudioTrack(filepath="/test/file.wav", title="Test Track")

   🔴 Line 55: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: assert track.filepath == "/test/file.wav"

   🔴 Line 67: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filepath="/test/file.wav",

   🔴 Line 76: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: assert track.filepath == "/test/file.wav"

   🔴 Line 106: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = AudioProcessor.get_audio_info("/nonexistent/file.wav")

   🔴 Line 122: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: assert result["filepath"] == "/test/file.wav"

   🔴 Line 148: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = AudioProcessor.get_audio_info("/test/file.wav")

   🔴 Line 176: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = AudioProcessor.get_audio_info("/test/file.wav")

   🔴 Line 199: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = AudioProcessor.convert_audio_format("/input.wav", "/output.mp3", "mp3")

   🔴 Line 202: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_from_file.assert_called_once_with("/input.wav")

   🔴 Line 203: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_audio.export.assert_called_once_with("/output.mp3", format="mp3")

   🔴 Line 212: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = AudioProcessor.convert_audio_format("/input.wav", "/output.mp3", "mp3")

   🔴 Line 238: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = AudioProcessor.normalize_audio("/input.wav", "/output.wav", -20.0)

   🔴 Line 243: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_with_gain.export.assert_called_once_with("/output.wav", format="wav")

   🔴 Line 252: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = AudioProcessor.normalize_audio("/input.wav", "/output.wav", -20.0)

   🔴 Line 264: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: waveform, sample_rate = AudioProcessor.extract_waveform_data("/test/file.wav", 1000)

   🔴 Line 279: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: waveform, sample_rate = AudioProcessor.extract_waveform_data("/test/file.wav", 1000)

   🔴 Line 302: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: waveform, sample_rate = AudioProcessor.extract_waveform_data("/test/file.mp3", 1000)

   🔴 Line 359: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: waveform, sample_rate = AudioProcessor.extract_waveform_data("/test/file.wav", 1000)

   🔴 Line 392: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = playlist.add_track("/test/file.wav")

   🔴 Line 397: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: assert track.filepath == "/test/file.wav"

   🔴 Line 407: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = playlist.add_track("/test/file.wav")

   🔴 Line 416: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track1 = AudioTrack("/test/file1.wav", "Track 1")

   🔴 Line 417: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track2 = AudioTrack("/test/file2.wav", "Track 2")

   🔴 Line 431: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track = AudioTrack("/test/file.wav", "Track")

   🔴 Line 442: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track1 = AudioTrack("/test/file1.wav", "Track 1")

   🔴 Line 443: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track2 = AudioTrack("/test/file2.wav", "Track 2")

   🔴 Line 456: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track = AudioTrack("/test/file.wav", "Track")

   🔴 Line 467: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track = AudioTrack("/test/file.wav", "Track")

   🔴 Line 478: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track = AudioTrack("/test/file.wav", "Track")

   🔴 Line 491: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track1 = AudioTrack("/test/file1.wav", "Track 1")

   🔴 Line 492: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track2 = AudioTrack("/test/file2.wav", "Track 2")

   🔴 Line 504: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track1 = AudioTrack("/test/file1.wav", "Track 1")

   🔴 Line 505: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track2 = AudioTrack("/test/file2.wav", "Track 2")

   🔴 Line 518: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track1 = AudioTrack("/test/file1.wav", "Track 1")

   🔴 Line 519: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track2 = AudioTrack("/test/file2.wav", "Track 2")

   🔴 Line 530: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track1 = AudioTrack("/test/file1.wav", "Track 1")

   🔴 Line 531: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track2 = AudioTrack("/test/file2.wav", "Track 2")

   🔴 Line 532: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track3 = AudioTrack("/test/file3.wav", "Track 3")

   🔴 Line 547: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track1 = AudioTrack("/test/file1.wav", "Track 1")

   🔴 Line 548: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track2 = AudioTrack("/test/file2.wav", "Track 2")

   🔴 Line 560: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track1 = AudioTrack("/test/file1.wav", "Track 1")

   🔴 Line 561: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track2 = AudioTrack("/test/file2.wav", "Track 2")

   🔴 Line 576: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track1 = AudioTrack("/test/file1.wav", "Track 1")

   🔴 Line 577: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track2 = AudioTrack("/test/file2.wav", "Track 2")

   🔴 Line 588: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track = AudioTrack("/test/file.wav", "Track")

   🔴 Line 599: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track = AudioTrack("/test/file.wav", "Track")

   🔴 Line 613: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track1 = AudioTrack("/test/file1.wav", "Track 1", duration=120.0)

   🔴 Line 614: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track2 = AudioTrack("/test/file2.wav", "Track 2", duration=180.0)

   🔴 Line 680: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = player.load_track("/test/file.wav")

   🔴 Line 684: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_add_track.assert_called_once_with("/test/file.wav")

   🔴 Line 695: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = player.load_track("/test/file.wav")

   🔴 Line 707: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = player.load_playlist(["/file1.wav", "/file2.wav", "/file3.wav"])

   🔴 Line 789: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_track = AudioTrack("/test/file.wav", "Test Track")

   🔴 Line 801: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_track = AudioTrack("/test/file.wav", "Test Track", duration=120.0)

   🔴 Line 866: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = processor.convert_audio_format("/test/input.wav", "/test/output.mp3", "mp3")

   🔴 Line 884: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = player.load_track("/nonexistent/file.wav")

   🔴 Line 903: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = processor.extract_waveform_data("/invalid/path.wav")

   🔴 Line 914: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = processor.convert_audio_format("/invalid/input.wav", "/invalid/output.mp3", "mp3")

   🔴 Line 922: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: track = AudioTrack(filepath="/nonexistent/file.wav", title="Test Track")

📁 tests\test_audio_processing_advanced.py
------------------------------------------
   🔴 Line 113: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: output_path="/test/output.wav",

   🔴 Line 124: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: assert result.output_path == "/test/output.wav"

   🔴 Line 203: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = enhancer.process_audio_file("/nonexistent/input.wav", "/tmp/output.wav")

   🔴 Line 215: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = enhancer.process_audio_file("/test/input.wav", "/tmp/output.wav")

   🔴 Line 231: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = enhancer.process_audio_file("/test/input.wav", "/tmp/output.wav")

   🔴 Line 264: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = enhancer.process_audio_file("/test/input.wav", "/tmp/output.wav", mock_progress_callback)

   🔴 Line 305: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: audio_data, sample_rate = enhancer._load_audio("/test/input.wav")

   🔴 Line 309: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_librosa.load.assert_called_once_with("/test/input.wav", sr=None, mono=False)

   🔴 Line 324: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: audio_data, sample_rate = enhancer._load_audio("/test/input.wav")

   🔴 Line 341: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: audio_data, sample_rate = enhancer._load_audio("/test/stereo.wav")

   🔴 Line 360: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: audio_data, sample_rate = enhancer._load_audio("/test/stereo.wav")

   🔴 Line 379: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: audio_data, sample_rate = enhancer._load_audio("/test/input.wav")

   🔴 Line 404: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: "/test/output.wav", mock_audio_data, mock_sample_rate, subtype="PCM_16"

   🔴 Line 416: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: enhancer._save_audio(mock_audio_data, mock_sample_rate, "/test/output.wav")

   🔴 Line 422: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: assert args[0] == "/test/output.wav"

   🔴 Line 446: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: enhancer._save_audio(mock_audio_data, mock_sample_rate, "/test/output.wav")

   🔴 Line 732: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = enhancer.convert_format("/input.wav", "/output.mp3", "mp3", 48000, 16)

   🔴 Line 735: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_from_file.assert_called_once_with("/input.wav")

   🔴 Line 736: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_audio.export.assert_called_once_with("/output.mp3", format="mp3")

   🔴 Line 748: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = enhancer.convert_format("/input.wav", "/output.wav", "wav")

   🔴 Line 751: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_load.assert_called_once_with("/input.wav")

   🔴 Line 752: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_save.assert_called_once_with(mock_audio_data, 44100, "/output.wav")

   🔴 Line 769: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = enhancer.convert_format("/input.wav", "/output.mp3", "mp3", 48000, 24)

   🔴 Line 788: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = enhancer.convert_format("/input.wav", "/output.wav", "wav", 22050)

   🔴 Line 803: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = enhancer.convert_format("/input.wav", "/output.mp3", "mp3")

   🔴 Line 810: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: input_files = ["/file1.wav", "/file2.wav"]

   🔴 Line 813: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_result1 = ProcessingResult(success=True, output_path="/out1.wav")

   🔴 Line 814: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_result2 = ProcessingResult(success=True, output_path="/out2.wav")

   🔴 Line 817: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: results = enhancer.batch_process(input_files, "/output")

   🔴 Line 827: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: input_files = ["/file1.wav", "/file2.wav", "/file3.wav"]

   🔴 Line 835: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_process.return_value = ProcessingResult(success=True, output_path="/out.wav")

   🔴 Line 837: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: results = enhancer.batch_process(input_files, "/output", mock_progress_callback)

   🔴 Line 853: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: input_files = ["/file1.wav", "/file2.wav"]

   🔴 Line 856: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: results = enhancer.batch_process(input_files, "/output")

   🔴 Line 886: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = converter.convert("/input.wav", "/output.mp3", "mp3", "high")

   🔴 Line 891: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: assert export_args[0] == ("/output.mp3",)

   🔴 Line 906: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = converter.convert("/input.wav", "/output.mp3", "mp3", "medium")

   🔴 Line 923: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = converter.convert("/input.wav", "/output.mp3", "mp3", "low")

   🔴 Line 941: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = converter.convert("/input.wav", "/output.ogg", "ogg", "high")

   🔴 Line 964: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = converter.convert("/input.wav", "/output.xyz", "xyz")

   🔴 Line 977: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = converter._convert_basic("/input.wav", "/output.wav", "wav")

   🔴 Line 980: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_enhancer._load_audio.assert_called_once_with("/input.wav")

   🔴 Line 987: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = converter._convert_basic("/input.wav", "/output.mp3", "mp3")

   🔴 Line 1053: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = enhance_audio_file("/test/input.wav", "/test/output.wav")

   🔴 Line 1057: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_enhancer.process_audio_file.assert_called_once_with("/test/input.wav", "/test/output.wav", None)

   🔴 Line 1067: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = convert_audio_format("/test/input.mp3", "/test/output.wav", "wav")

   🔴 Line 1070: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_from_file.assert_called_once_with("/test/input.mp3")

   🔴 Line 1071: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_audio.export.assert_called_once_with("/test/output.wav", format="wav")

   🔴 Line 1080: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = convert_audio_format("/test/input.mp3", "/test/output.wav", "wav")

   🔴 Line 1087: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = convert_audio_format("/test/input.mp3", "/test/output.wav", "wav")

   🔴 Line 1108: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: analysis = get_audio_analysis("/test/input.wav")

   🔴 Line 1124: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: analysis = get_audio_analysis("/test/input.wav")

   🔴 Line 1153: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: enhancer._load_audio("/test/audio.mp3")

   🔴 Line 1195: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = enhancer.convert_format("/test/input.wav", "/test/output.wav", "wav")

   🔴 Line 1229: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: enhancer._load_audio("/test/nonexistent.wav")

   🔴 Line 1263: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = converter.convert("/input.wav", "/output.xyz", "unsupported_format")

   🔴 Line 1281: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: enhancer.convert_format("/input.wav", "/output.wav", "wav", None, 32)

   🔴 Line 1319: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = enhancer.process_audio_file("/test/input.wav", "/test/output.wav")

📁 tests\test_audio_visualization.py
------------------------------------
   🔴 Line 291: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = visualizer.load_audio("/nonexistent/file.wav")

   🔴 Line 309: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = visualizer.load_audio("/test/file.wav")

   🔴 Line 329: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = visualizer.load_audio("/test/stereo.wav")

   🔴 Line 345: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = visualizer.load_audio("/test/file.wav")

   🔴 Line 740: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = widget.load_audio("/test/file.wav")

   🔴 Line 743: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: widget.waveform_visualizer.load_audio.assert_called_once_with("/test/file.wav")

   🔴 Line 753: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = widget.load_audio("/nonexistent/file.wav")

   🔴 Line 1144: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = visualizer.load_audio("/test/empty.wav")

   🔴 Line 1153: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = visualizer.load_audio("/test/error.wav")

📁 tests\test_audio_visualization_edge_cases.py
-----------------------------------------------
   🔴 Line 248: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = visualizer.load_audio("/test/empty.wav")

📁 tests\test_audio_visualization_enhanced.py
---------------------------------------------
   🔴 Line 271: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = visualizer.load_audio("/test/file.wav")

   🔴 Line 554: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = widget.load_audio("/test/file.wav")

📁 tests\test_config_and_logger.py
----------------------------------
   🔴 Line 90: home_directory_access
       Pattern: os\.path\.expanduser\(["\']~
       Code: assert os.path.expanduser("~") in config["download_directory"]

   🔴 Line 90: home_directory_access
       Pattern: expanduser\(["\']~
       Code: assert os.path.expanduser("~") in config["download_directory"]

📁 tests\test_constants.py
--------------------------
   🔴 Line 125: config_file_creation
       Pattern: hidock_config\.json
       Code: assert constants.CONFIG_FILE_NAME == "hidock_config.json"

   🔴 Line 123: config_file_creation
       Pattern: CONFIG_FILE_NAME
       Code: assert hasattr(constants, "CONFIG_FILE_NAME")

   🔴 Line 124: config_file_creation
       Pattern: CONFIG_FILE_NAME
       Code: assert isinstance(constants.CONFIG_FILE_NAME, str)

   🔴 Line 125: config_file_creation
       Pattern: CONFIG_FILE_NAME
       Code: assert constants.CONFIG_FILE_NAME == "hidock_config.json"

   🔴 Line 126: config_file_creation
       Pattern: CONFIG_FILE_NAME
       Code: assert constants.CONFIG_FILE_NAME.endswith(".json")

   🔴 Line 135: config_file_creation
       Pattern: CONFIG_FILE_NAME
       Code: config_file = constants.CONFIG_FILE_NAME

📁 tests\test_data_isolation.py
-------------------------------
   🔴 Line 150: config_file_creation
       Pattern: hidock_config\.json
       Code: Path.home() / "hidock_config.json",

   🔴 Line 153: config_file_creation
       Pattern: hidock_config\.json
       Code: Path("hidock_config.json"),  # Current directory

   🔴 Line 154: config_file_creation
       Pattern: hidock_tool_config\.json
       Code: Path("hidock_tool_config.json"),  # Current directory

   🔴 Line 32: home_directory_access
       Pattern: Path\.home\(\)(?!\s*#.*test)
       Code: real_home = str(Path.home())

   🔴 Line 51: home_directory_access
       Pattern: Path\.home\(\)(?!\s*#.*test)
       Code: real_home = str(Path.home())

   🔴 Line 64: home_directory_access
       Pattern: Path\.home\(\)(?!\s*#.*test)
       Code: real_home = str(Path.home())

   🔴 Line 69: home_directory_access
       Pattern: Path\.home\(\)(?!\s*#.*test)
       Code: """Verify Path.home() returns test directory."""

   🔴 Line 70: home_directory_access
       Pattern: Path\.home\(\)(?!\s*#.*test)
       Code: test_home = Path.home()

   🔴 Line 125: home_directory_access
       Pattern: Path\.home\(\)(?!\s*#.*test)
       Code: real_home = str(Path.home())

   🔴 Line 150: home_directory_access
       Pattern: Path\.home\(\)(?!\s*#.*test)
       Code: Path.home() / "hidock_config.json",

   🔴 Line 151: home_directory_access
       Pattern: Path\.home\(\)(?!\s*#.*test)
       Code: Path.home() / ".hidock",

   🔴 Line 152: home_directory_access
       Pattern: Path\.home\(\)(?!\s*#.*test)
       Code: Path.home() / "HiDock_Downloads",

   🔴 Line 77: home_directory_access
       Pattern: os\.path\.expanduser\(["\']~
       Code: expanded = os.path.expanduser("~")

   🔴 Line 83: home_directory_access
       Pattern: os\.path\.expanduser\(["\']~
       Code: expanded_sub = os.path.expanduser("~/.hidock")

   🔴 Line 77: home_directory_access
       Pattern: expanduser\(["\']~
       Code: expanded = os.path.expanduser("~")

   🔴 Line 83: home_directory_access
       Pattern: expanduser\(["\']~
       Code: expanded_sub = os.path.expanduser("~/.hidock")

   🔴 Line 92: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: "download_directory": "/test/path",

📁 tests\test_device_communication.py
-------------------------------------
   🔴 Line 580: real_path_usage
       Pattern: ["\'][A-Za-z]:[/\\]
       Code: os.path.exists("C:\\"),  # Windows system

📁 tests\test_file_operations_manager_consolidated.py
-----------------------------------------------------
   🔴 Line 85: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 92: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: assert metadata.device_path == "/device/test.wav"

   🔴 Line 108: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 109: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: local_path="/local/test.wav",

   🔴 Line 121: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: assert metadata.local_path == "/local/test.wav"

   🔴 Line 134: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test.wav", size=1024, duration=30.0, date_created=now, device_path="/device/test.wav"

   🔴 Line 138: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test.wav", size=1024, duration=30.0, date_created=now, device_path="/device/test.wav"

   🔴 Line 142: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="different.wav", size=1024, duration=30.0, date_created=now, device_path="/device/different.wav"

   🔴 Line 155: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 267: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="important_meeting.wav", size=1024, duration=30.0, date_created=now, device_path="/device/test.wav"

   🔴 Line 287: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test.wav", size=1024, duration=30.0, date_created=now, device_path="/device/test.wav"

   🔴 Line 311: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test.wav", size=1024, duration=30.5, date_created=now, device_path="/device/test.wav"

   🔴 Line 335: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test.wav", size=1024, duration=30.0, date_created=base_date, device_path="/device/test.wav"

   🔴 Line 359: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test.wav", size=1024, duration=30.0, date_created=now, device_path="/device/test.wav"

   🔴 Line 384: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 412: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 418: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test.wav", size=1024, duration=30.0, date_created=now, device_path="/device/test.wav"

   🔴 Line 443: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 444: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: local_path="/local/test.wav",

   🔴 Line 449: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test.wav", size=1024, duration=30.0, date_created=now, device_path="/device/test.wav"

   🔴 Line 472: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 473: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: local_path="/local/test.wav",

   🔴 Line 502: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 525: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 543: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="Important_Meeting.WAV", size=1024, duration=30.0, date_created=now, device_path="/device/test.wav"

   🔴 Line 624: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 625: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: local_path="/local/test.wav",

   🔴 Line 694: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 724: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test1.wav", size=1024, duration=30.5, date_created=now, device_path="/device/test1.wav"

   🔴 Line 727: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test2.wav", size=2048, duration=60.0, date_created=now, device_path="/device/test2.wav"

   🔴 Line 810: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/high.wav",

   🔴 Line 820: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/medium.wav",

   🔴 Line 830: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/low.wav",

   🔴 Line 840: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/unknown.wav",

   🔴 Line 856: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 867: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/efficient.wav",

   🔴 Line 878: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/zero.wav",

   🔴 Line 917: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: file1 = FileMetadata("z_file.wav", 1000, 30.0, now - timedelta(days=1), "/device/z.wav")

   🔴 Line 918: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: file2 = FileMetadata("a_file.wav", 2000, 60.0, now, "/device/a.wav", download_count=5)

   🔴 Line 919: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: file3 = FileMetadata("m_file.mp3", 1500, 45.0, now - timedelta(hours=12), "/device/m.mp3")

   🔴 Line 973: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: metadata1 = FileMetadata("meeting.wav", 1000, 30.0, now, "/device/meeting.wav", tags=["work"])

   🔴 Line 974: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: metadata2 = FileMetadata("personal.mp3", 2000, 60.0, now, "/device/personal.mp3", tags=["personal"])

   🔴 Line 1085: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: ("old_file.wav", 1000, 30.0, datetime.now().isoformat(), "/device/old.wav", old_timestamp),

   🔴 Line 1393: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test.wav", size=1024, duration=30.0, date_created=datetime.now(), device_path="/device/test.wav"

   🔴 Line 1470: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 1558: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test.wav", size=1024, duration=30.0, date_created=datetime.now(), device_path="/device/test.wav"

   🔴 Line 1662: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 1689: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 1712: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 1713: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: local_path="/nonexistent/test.wav",

   🔴 Line 1730: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="test.wav", size=1024, duration=30.0, date_created=datetime.now(), device_path="/device/test.wav"

   🔴 Line 1785: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 1849: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: non_existent_path = Path("/nonexistent/file.wav")

   🔴 Line 1863: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 1881: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 1908: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 1973: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/test.wav",

   🔴 Line 2227: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: device_path="/device/file1.wav",

   🔴 Line 2228: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: local_path="/local/file1.wav",

   🔴 Line 2231: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: filename="file2.wav", size=2048, duration=60.0, date_created=now, device_path="/device/file2.wav"

   🔴 Line 1849: real_path_usage
       Pattern: Path\(["\'][^"\']*[/\\](?!tmp|temp|test)
       Code: non_existent_path = Path("/nonexistent/file.wav")

📁 tests\test_fixes.py
----------------------
   🔴 Line 106: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: offline_manager = OfflineModeManager(file_ops, "/test/download")

📁 tests\test_gui_components.py
-------------------------------
   🔴 Line 156: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: safe_filename = original.replace(":", "-").replace(" ", "_").replace("\\", "_").replace("/", "_")

📁 tests\test_hta_converter.py
------------------------------
   🔴 Line 55: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = self.converter.convert_hta_to_wav("/nonexistent/file.hta")

   🔴 Line 404: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: invalid_path = "/nonexistent/directory/output.wav"

   🔴 Line 420: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: hta_path = "/some/path/test_audio.hta"

📁 tests\test_offline_mode_manager.py
-------------------------------------
   🔴 Line 71: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: FileMetadata("file1.wav", 1024, 60.0, datetime(2024, 1, 1, 12, 0, 0), "/device/file1.wav"),

   🔴 Line 72: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: FileMetadata("file2.wav", 2048, 120.0, datetime(2024, 1, 2, 12, 0, 0), "/device/file2.wav"),

   🔴 Line 108: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: "file1.wav", 1024, 60.0, datetime(2024, 1, 1, 12, 0, 0), "/device/file1.wav", local_path=file1_path

   🔴 Line 111: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: "file2.wav", 2048, 120.0, datetime(2024, 1, 2, 12, 0, 0), "/device/file2.wav", local_path=None

   🔴 Line 118: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: "/device/file3.wav",

   🔴 Line 119: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: local_path="/nonexistent/file3.wav",

   🔴 Line 166: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: FileMetadata("file1.wav", 1024, 60.0, datetime(2024, 1, 1, 12, 0, 0), "/device/file1.wav"),

   🔴 Line 167: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: FileMetadata("file2.wav", 2048, 120.0, datetime(2024, 1, 2, 12, 0, 0), "/device/file2.wav"),

📁 tests\test_settings_persistence.py
-------------------------------------
   🔴 Line 32: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: "download_directory": "/test/path",

   🔴 Line 122: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_window.download_directory = "/test/path"

   🔴 Line 224: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_save_config.assert_called_once_with({"download_directory": "/new/path"})

   🔴 Line 225: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: assert mock_gui.config["download_directory"] == "/new/path"

   🔴 Line 226: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: assert mock_gui.download_directory == "/new/path"

📁 tests\test_test_utils.py
---------------------------
   🔴 Line 28: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: assert metadata.device_path == "/device/test_file_0.wav"

   🔴 Line 168: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: FileSystemTestUtils.cleanup_temp_files(["/nonexistent/file.txt"])

📁 tests\test_transcription.py
------------------------------
   🔴 Line 85: real_path_usage
       Pattern: ["\'][A-Za-z]:[/\\]
       Code: os.path.exists("C:\\"),

📁 tests\test_transcription_module.py
-------------------------------------
   🔴 Line 133: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await transcribe_audio("/test/audio.wav", "gemini", "test_key")

   🔴 Line 137: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_ai_service.transcribe_audio.assert_called_once_with("gemini", "/test/audio.wav", "auto")

   🔴 Line 145: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await transcribe_audio("/test/audio.wav", "gemini", "test_key")

   🔴 Line 156: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await transcribe_audio("/test/audio.wav", "gemini", "test_key")

   🔴 Line 170: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await transcribe_audio("/test/audio.wav", "gemini", "test_key")

   🔴 Line 182: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await transcribe_audio("/test/audio.wav", "openai", "test_key", config, "en")

   🔴 Line 186: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_ai_service.transcribe_audio.assert_called_once_with("openai", "/test/audio.wav", "en")

   🔴 Line 316: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: duration = _get_audio_duration("/nonexistent/file.wav")

   🔴 Line 372: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/test/audio.wav", "gemini", "test_key")

   🔴 Line 379: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_transcribe.assert_called_once_with("/test/audio.wav", "gemini", "test_key", None, "auto")

   🔴 Line 391: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/test/audio.wav", "gemini", "test_key")

   🔴 Line 405: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/nonexistent/audio.wav", "gemini", "test_key")

   🔴 Line 425: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/test/audio.wav", "openai", "test_key", config, "en")

   🔴 Line 430: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_transcribe.assert_called_once_with("/test/audio.wav", "openai", "test_key", config, "en")

   🔴 Line 451: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/test/audio.wav", "gemini", "test_key")

   🔴 Line 466: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/test/audio.wav", "gemini", "test_key")

   🔴 Line 481: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/test/audio.wav", "gemini", "test_key")

   🔴 Line 500: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/test/audio.hta", "gemini", "test_key")

   🔴 Line 504: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: mock_convert_hta.assert_called_once_with("/test/audio.hta")

   🔴 Line 516: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/test/audio.hta", "gemini", "test_key")

   🔴 Line 591: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: @patch("transcription_module.os.path.splitext", return_value=("/test/audio", ".hta"))

   🔴 Line 612: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/test/audio.hta", "gemini", "test_key")

   🔴 Line 709: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/test/audio.mp3", "gemini", "test_key")

   🔴 Line 733: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/test/audio.hta", "gemini", "test_key")

   🔴 Line 768: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await transcribe_audio("/test/audio.wav", "gemini", "test_key")

   🔴 Line 818: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await transcribe_audio("/test/audio.wav", "gemini", "test_key")

   🔴 Line 866: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: result = await process_audio_file_for_insights("/test/audio.wav", "gemini", "test_key")

📁 tests\test_utils.py
----------------------
   🔴 Line 36: real_path_usage
       Pattern: ["\']\/(?!tmp|var|temp)
       Code: "device_path": f"/device/test_file_{i}.wav",

💡 RECOMMENDATIONS:

For each risk found above:
1. 🔒 Use temporary files/directories (tempfile module)
2. 🧪 Mock file operations instead of real I/O
3. 🎭 Patch config paths to use test directories
4. 🛡️  Use pytest fixtures for isolation
5. 🧹 Ensure proper cleanup in teardown methods

🚨 HIGH PRIORITY: Fix any 'direct_file_write' or 'config_file_creation' risks!