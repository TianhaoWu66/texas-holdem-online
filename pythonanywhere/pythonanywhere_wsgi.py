# PythonAnywhere WSGI 入口（把 Web 页的 WSGI configuration file 替换成这个）
# 记得把 /home/你的用户名 改成你真实的路径，例如 /home/wang/spice-road
import sys

sys.path.insert(0, "/home/你的用户名/spice-road")

from app import app as application
