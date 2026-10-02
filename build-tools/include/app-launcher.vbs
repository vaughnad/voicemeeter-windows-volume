scriptdir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
Set Shell = CreateObject("Shell.Application")

'{{INJECT_START:PKG}}
Set running = GetObject("winmgmts:\\.\root\cimv2").ExecQuery("Select ProcessId from Win32_Process Where Name = 'VMWV.exe'")
If running.Count > 0 Then WScript.Quit 0
Shell.ShellExecute scriptDir & "\required\VMWV.exe", , , "runas", 0
'{{INJECT_END:PKG}}
