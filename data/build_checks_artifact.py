"""從 checks.html 產生發佈成 Artifact 用的版本（去掉 doctype／html／head／body 外框）。
用法：python3 data/build_checks_artifact.py 輸出路徑"""
import sys, pathlib
src = pathlib.Path(__file__).resolve().parent.parent / "checks.html"
s = src.read_text(encoding="utf-8")
body = s.split("<!--ARTIFACT-START-->", 1)[1].split("<!--ARTIFACT-END-->", 1)[0]
body = body.replace("\n</head>\n<body>\n", "\n", 1)
pathlib.Path(sys.argv[1]).write_text(body.strip() + "\n", encoding="utf-8")
