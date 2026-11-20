Unicode true
Name "Halo Desk"
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
OutFile "..\dist\halo-desk-${VERSION}-win-x64.exe"
InstallDir "$LOCALAPPDATA\Halo Desk"
RequestExecutionLevel user
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Halo Desk"
  SetOutPath "$INSTDIR"
  File "..\target\release\halo-desk.exe"
  WriteUninstaller "$INSTDIR\Désinstaller.exe"
  CreateShortCut "$SMPROGRAMS\Halo Desk.lnk" "$INSTDIR\halo-desk.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HaloDesk" "DisplayName" "Halo Desk"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HaloDesk" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HaloDesk" "UninstallString" '"$INSTDIR\Désinstaller.exe"'
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\Halo Desk.lnk"
  Delete "$INSTDIR\halo-desk.exe"
  Delete "$INSTDIR\Désinstaller.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\HaloDesk"
SectionEnd
